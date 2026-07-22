use std::{
    process::{Child, Command},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Sidecar do daemon Node (spawnado no setup, morto no exit do app).
static DAEMON_CHILD: Mutex<Option<Child>> = Mutex::new(None);

// Tray em 88×88 (4× p/ downscale crispo; macOS exibe ~22px) — Monograma Y.
const TW: u32 = 88;
const TH: u32 = 88;

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// Agent HTTP com timeout curto — cross-platform, sem depender de `curl` no PATH.
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(2))
        .build()
}

/// POST simples ao daemon. Ações do tray/hotkeys.
fn daemon_post(path: &str) {
    let url = format!("http://localhost:3891{}", path);
    let _ = http_agent().post(&url).call();
}

/// POST com corpo JSON (ex.: trocar persona).
fn daemon_post_json(path: &str, body: &str) {
    let url = format!("http://localhost:3891{}", path);
    let _ = http_agent()
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(body);
}

/// GET que devolve o corpo como String (None em erro/timeout).
fn daemon_get(path: &str) -> Option<String> {
    let url = format!("http://localhost:3891{}", path);
    http_agent().get(&url).call().ok()?.into_string().ok()
}

/// Lê as personas do daemon (id, label) p/ o submenu do tray.
fn fetch_personas() -> Vec<(String, String)> {
    if let Some(body) = daemon_get("/personas") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(arr) = j.as_array() {
                return arr
                    .iter()
                    .filter_map(|p| {
                        let id = p.get("id")?.as_str()?.to_string();
                        let label = p.get("label").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                        Some((id, label))
                    })
                    .collect();
            }
        }
    }
    vec![]
}

// YASS roxo dark → clareia com a energia da fala.
const C_DEEP: (f64, f64, f64) = (0x5a as f64, 0x2c as f64, 0x9a as f64); // #5a2c9a (roxo dark, parado)
const C_CYAN: (f64, f64, f64) = (0xc7 as f64, 0x7d as f64, 0xff as f64); // #c77dff (brand, médio)
const C_GLOW: (f64, f64, f64) = (0xd9 as f64, 0xa8 as f64, 0xff as f64); // #d9a8ff (glow)

/// cor pela energia 0..1: roxo dark → brand → quase branco (clareia ao falar)
fn col(e: f64) -> (u8, u8, u8) {
    let e = e.clamp(0.0, 1.0);
    let (a, b, t) = if e < 0.5 {
        (C_DEEP, C_CYAN, e / 0.5)
    } else {
        (C_CYAN, (255.0, 255.0, 255.0), (e - 0.5) / 0.5 * 0.85)
    };
    (
        (a.0 + (b.0 - a.0) * t).round() as u8,
        (a.1 + (b.1 - a.1) * t).round() as u8,
        (a.2 + (b.2 - a.2) * t).round() as u8,
    )
}

/// Compositing por "mais forte vence" (sobre fundo transparente) — bom p/ glow.
fn put(buf: &mut [u8], x: i32, y: i32, c: (u8, u8, u8), a: u8) {
    if x < 0 || y < 0 || x as u32 >= TW || y as u32 >= TH {
        return;
    }
    let idx = ((y as u32 * TW + x as u32) * 4) as usize;
    if a > buf[idx + 3] {
        buf[idx] = c.0;
        buf[idx + 1] = c.1;
        buf[idx + 2] = c.2;
        buf[idx + 3] = a;
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// distância de um ponto ao segmento a→b
fn dist_seg(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = bx - ax;
    let dy = by - ay;
    let len2 = dx * dx + dy * dy;
    let t = if len2 <= 1e-6 { 0.0 } else { (((px - ax) * dx + (py - ay) * dy) / len2).clamp(0.0, 1.0) };
    let cx = ax + t * dx;
    let cy = ay + t * dy;
    ((px - cx).powi(2) + (py - cy).powi(2)).sqrt()
}

/// Desenha um traço (núcleo brilhante + halo de glow) com energia controlando o brilho.
fn stroke(buf: &mut [u8], a: (f64, f64), b: (f64, f64), hw: f64, gw: f64, energy: f64) {
    // núcleo: roxo dark parado → clareia com a energia
    let core = col(energy);
    let glow = col((energy * 0.7).max(0.15)); // halo segue, um pouco mais claro
    let ga = 0.45 + energy * 0.45; // intensidade do halo
    let minx = (a.0.min(b.0) - hw - gw).floor() as i32;
    let maxx = (a.0.max(b.0) + hw + gw).ceil() as i32;
    let miny = (a.1.min(b.1) - hw - gw).floor() as i32;
    let maxy = (a.1.max(b.1) + hw + gw).ceil() as i32;
    for y in miny..=maxy {
        for x in minx..=maxx {
            let d = dist_seg(x as f64 + 0.5, y as f64 + 0.5, a.0, a.1, b.0, b.1);
            if d <= hw {
                put(buf, x, y, core, 255);
            } else if d <= hw + gw {
                let t = 1.0 - (d - hw) / gw;
                let al = (t * ga * 255.0).round().clamp(0.0, 255.0) as u8;
                put(buf, x, y, glow, al);
            }
        }
    }
}

/// Monograma Y (bold) + raios 360° fortes — como na galeria. Raios grossos e
/// brilhantes (burst de 8) p/ lerem no tamanho da menu bar; glow/escala e
/// velocidade dos raios dirigidos pela energia/velocidade da fala.
fn draw_y(energy: f64, phase: f64) -> Vec<u8> {
    let mut buf = vec![0u8; (TW * TH * 4) as usize];
    let cx = TW as f64 / 2.0;
    let cy = TH as f64 / 2.0;
    let e = energy.clamp(0.0, 1.0);
    let breathe = 0.5 + 0.5 * (phase * std::f64::consts::TAU * 0.8).sin();
    let pulse = (e + breathe * 0.10).min(1.0);
    let halo_c = col((e * 0.6).max(0.1)); // roxo dark parado, clareia ao falar

    // halo central modesto (presença, sem borrar)
    let halo_r = 13.0 + pulse * 8.0;
    for y in 0..TH as i32 {
        for x in 0..TW as i32 {
            let d = ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt();
            if d < halo_r {
                let t = 1.0 - d / halo_r;
                let al = (t * t * (45.0 + pulse * 110.0)).round().clamp(0.0, 255.0) as u8;
                put(&mut buf, x, y, halo_c, al);
            }
        }
    }

    // RAIOS 360° — 8 grossos e brilhantes, radiando (sempre; fortes ao falar)
    let n = 8;
    let speed = 0.5 + e * 1.5; // velocidade da fala → velocidade dos raios
    for i in 0..n {
        let ang = (i as f64) * std::f64::consts::TAU / n as f64;
        let prog = ((now_ms() / 1000.0 * speed) + i as f64 / n as f64).fract();
        let rin = lerp(27.0, 38.0, prog);
        let p0 = (cx + ang.cos() * rin, cy + ang.sin() * rin);
        let p1 = (cx + ang.cos() * (rin + 13.0), cy + ang.sin() * (rin + 13.0));
        // roxo dark parado → bem claro ao falar
        let bright = (0.22 + e * 0.78) * (1.0 - prog * 0.7);
        stroke(&mut buf, p0, p1, 3.2, 2.2, bright);
    }

    // Y BOLD (deixa margem p/ os raios respirarem)
    let s = 1.0 + pulse * 0.12;
    let sc = |p: (f64, f64)| (cx + (p.0 - cx) * s, cy + (p.1 - cy) * s);
    let j = sc((44.0, 50.0));
    let tl = sc((20.0, 22.0));
    let tr = sc((68.0, 22.0));
    let bt = sc((44.0, 74.0));
    let hw = 7.5 + e * 2.5;
    let gw = 3.0 + e * 3.0;
    stroke(&mut buf, j, tl, hw, gw, e);
    stroke(&mut buf, j, tr, hw, gw, e);
    stroke(&mut buf, j, bt, hw, gw, e);
    buf
}

fn toggle(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Poll the daemon; while an item is playing, animate the tray icon as a waveform
/// driven by the audio envelope. Idle → restore base icon.
fn spawn_wave(app: tauri::AppHandle) {
    // média suavizada da amplitude (envelope) → energia da fala
    let mut smooth = [0.0f64; 5];
    thread::spawn(move || loop {
        let mut levels = [0.0f64; 5];
        let mut playing = false;

        if let Some(body) = daemon_get("/history") {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(arr) = json.as_array() {
                    if let Some(it) = arr.iter().find(|i| i.get("status").and_then(|s| s.as_str()) == Some("playing")) {
                        if let Some(env) = it.get("envelope").and_then(|e| e.as_array()) {
                            let started = it.get("startedAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
                            let dur = it.get("durationMs").and_then(|v| v.as_f64()).unwrap_or(1.0).max(1.0);
                            let n = env.len();
                            if n > 0 && started > 0.0 {
                                playing = true;
                                let t = ((now_ms() - started) / dur).clamp(0.0, 1.0);
                                let center = ((t * n as f64) as i64).clamp(0, n as i64 - 1);
                                for (i, slot) in levels.iter_mut().enumerate() {
                                    let idx = center - 2 + i as i64;
                                    if idx >= 0 && (idx as usize) < n {
                                        *slot = env[idx as usize].as_f64().unwrap_or(0.0);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // lerp → suaviza entre amostras
        let mut settled = true;
        for (s, t) in smooth.iter_mut().zip(levels.iter()) {
            *s += (t - *s) * 0.35;
            if (*s - t).abs() > 0.01 {
                settled = false;
            }
        }
        let energy: f64 = smooth.iter().copied().sum::<f64>() / 5.0;
        let active = playing || !settled;
        // falando → energia do envelope (mín. visível); ocioso → Y fraco, sem raios
        let e = if playing { energy.max(0.25) } else if !settled { energy.max(0.12) } else { 0.12 };

        if let Some(tray) = app.tray_by_id("main") {
            let rgba = draw_y(e, now_ms() / 1000.0);
            let _ = tray.set_icon(Some(Image::new_owned(rgba, TW, TH)));
        }
        thread::sleep(Duration::from_millis(if active { 50 } else { 140 }));
    });
}

/// Semeia os defaults de config (personas/glossary, bundlados como resources)
/// em ~/.yass no primeiro run — o daemon compilado lê tudo de lá.
fn seed_configs(app: &tauri::App) {
    let Ok(res_dir) = app.path().resource_dir() else { return };
    let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
    else { return };
    let data = home.join(".yass");
    let _ = std::fs::create_dir_all(&data);
    for name in ["personas.json", "glossary.json"] {
        let dst = data.join(name);
        if !dst.exists() {
            let src = res_dir.join("seed").join(name);
            if src.exists() {
                let _ = std::fs::copy(&src, &dst);
            }
        }
    }
    // O hook do Claude vive em ~/.yass (o daemon o referencia ao fiar a
    // integração). Atualiza a cada boot p/ acompanhar a versão do app. Isto NÃO
    // toca ~/.claude — só a pasta de dados do próprio YASS.
    let hook_src = res_dir.join("seed").join("speak-hook.js");
    if hook_src.exists() {
        let _ = std::fs::copy(&hook_src, data.join("speak-hook.js"));
    }
}

/// Sobe o daemon como sidecar se não houver um rodando (GET /health). O binário
/// `yass-daemon` é empacotado via bundle.externalBin e vive ao lado do executável.
/// Duplo-launch é inofensivo: o daemon sai sozinho em EADDRINUSE.
fn spawn_daemon(app: tauri::AppHandle, res_dir: Option<std::path::PathBuf>) {
    if daemon_get("/health").is_some() {
        return; // já tem daemon (ex.: modo dev rodando do repo)
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    let name = if cfg!(windows) { "yass-daemon.exe" } else { "yass-daemon" };
    let bin = dir.join(name);
    if !bin.exists() {
        return; // dev sem sidecar empacotado — daemon sobe pelo repo
    }
    let mut cmd = Command::new(&bin);
    // Aponta o daemon compilado para o dist bundlado (o embed do bun não é
    // confiável entre plataformas; o resource sempre existe ao lado do app).
    if let Some(rd) = res_dir {
        cmd.env("YASS_DIST", rd.join("dist"));
    }
    // Windows: sem isso o sidecar (subsistema console) abre um terminal preto.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(child) = cmd.spawn() {
        *DAEMON_CHILD.lock().unwrap() = Some(child);
        // Espera a saúde FORA do thread principal: o sidecar tem cold-start lento no
        // Windows (scan do Defender + extração passam de vários segundos) e bloquear o
        // setup congelava a janela ("Não está respondendo"). Quando ficar saudável,
        // recarrega a webview p/ a UI montar contra o backend vivo (só se não subiu
        // instantâneo — evita flash desnecessário no macOS).
        thread::spawn(move || {
            for i in 0..120 {
                if daemon_get("/health").is_some() {
                    if i > 0 {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.location.reload()");
                        }
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(250));
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            seed_configs(app);
            let res_dir = app.path().resource_dir().ok();
            spawn_daemon(app.handle().clone(), res_dir);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ── atalhos globais: (Cmd|Ctrl)+Shift+M (mute) / N (skip) / X (stop) ──
            // Cmd no macOS; Ctrl no Windows/Linux (SUPER lá é a tecla Windows/Meta).
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
                #[cfg(target_os = "macos")]
                let base = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let base = Modifiers::CONTROL;
                let m = Shortcut::new(Some(base | Modifiers::SHIFT), Code::KeyM);
                let n = Shortcut::new(Some(base | Modifiers::SHIFT), Code::KeyN);
                let x = Shortcut::new(Some(base | Modifiers::SHIFT), Code::KeyX);
                let (hm, hn, hx) = (m, n, x);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, sc, ev| {
                            if ev.state() == ShortcutState::Pressed {
                                if *sc == hm {
                                    daemon_post("/toggle-mute");
                                } else if *sc == hn {
                                    daemon_post("/skip");
                                } else if *sc == hx {
                                    daemon_post("/stop");
                                }
                            }
                        })
                        .build(),
                )?;
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let gs = app.global_shortcut();
                let _ = gs.register(m);
                let _ = gs.register(n);
                let _ = gs.register(x);
            }

            // ── menu do tray: mostrar · mute/skip/stop · personas · sair ──
            let acc = if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" };
            let show = MenuItem::with_id(app, "show", "Mostrar / ocultar YASS", true, None::<&str>)?;
            let mute = MenuItem::with_id(app, "mute", "Mutar / desmutar", true, Some(format!("{acc}+Shift+M")))?;
            let skip = MenuItem::with_id(app, "skip", "Pular", true, Some(format!("{acc}+Shift+N")))?;
            let stop = MenuItem::with_id(app, "stop", "Parar tudo", true, Some(format!("{acc}+Shift+X")))?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let s1 = PredefinedMenuItem::separator(app)?;
            let s2 = PredefinedMenuItem::separator(app)?;
            let s3 = PredefinedMenuItem::separator(app)?;

            // submenu de personas (lido do daemon)
            let personas = fetch_personas();
            let persona_items: Vec<MenuItem<_>> = personas
                .iter()
                .map(|(id, label)| {
                    MenuItem::with_id(app, format!("persona:{}", id), label, true, None::<&str>)
                })
                .collect::<Result<_, _>>()?;
            let persona_refs: Vec<&dyn IsMenuItem<_>> =
                persona_items.iter().map(|i| i as &dyn IsMenuItem<_>).collect();
            let personas_sub = Submenu::with_items(app, "Personalidade", true, &persona_refs)?;

            let menu = Menu::with_items(
                app,
                &[&show, &s1, &mute, &skip, &stop, &s2, &personas_sub, &s3, &quit],
            )?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(false) // mantém o roxo (não monocromático)
                .tooltip("Y.A.S.S. — Your AI Speaking System")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "show" => toggle(app),
                        "quit" => app.exit(0),
                        "mute" => daemon_post("/toggle-mute"),
                        "skip" => daemon_post("/skip"),
                        "stop" => daemon_post("/stop"),
                        _ if id.starts_with("persona:") => {
                            let pid = &id["persona:".len()..];
                            daemon_post_json("/config", &format!("{{\"persona\":\"{}\"}}", pid));
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            spawn_wave(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, event| {
        // App fechando → derruba o sidecar do daemon (se fomos nós que subimos).
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = DAEMON_CHILD.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}

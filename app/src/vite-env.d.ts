/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API do daemon YASS (default http://localhost:3891). */
  readonly VITE_YASS_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

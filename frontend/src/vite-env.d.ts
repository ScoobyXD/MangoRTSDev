/// <reference types="vite/client" />
// Vite type augmentations for import.meta.env access across frontend modules.

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COMPANY_ID?: string;
  readonly VITE_WORKTREE_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

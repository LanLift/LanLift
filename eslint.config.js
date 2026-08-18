import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'release/**',
      'dist/**',
      '**/node_modules/**',
      'relay/remote-web.js', // esbuild 產物
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      // LanLift 全部原始碼為 CommonJS（package.json 未宣告 type: module）
      sourceType: 'commonjs',
      globals: {
        // Node.js 全域（src/relay/test）
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        crypto: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        // 瀏覽器端（行動網頁與 desktop renderer）
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        EventSource: 'readonly',
        WebSocket: 'readonly',
        RTCPeerConnection: 'readonly',
        RTCSessionDescription: 'readonly',
        RTCIceCandidate: 'readonly',
        // Electron 渲染層
        lanliftAPI: 'readonly',
        // Node 測試執行器注入的全域
        test: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        mock: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-catch': 'off',
      'no-inner-declarations': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'curly': ['error', 'all'],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
      'keyword-spacing': ['error'],
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreComments: true }],
    },
  },
  {
    // 測試檔案允許較長的行（描述字串）
    files: ['test/**/*.js'],
    rules: {
      'max-len': 'off',
      'no-console': 'off',
    },
  },
  {
    // eslint.config.js 本身是 ESM（必須放在最後以覆蓋上面的 commonjs）
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2023,
    },
    rules: {
      'max-len': 'off',
      'no-console': 'off',
    },
  },
];

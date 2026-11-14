import { writeFile } from 'node:fs/promises'
import { build } from 'vite'

await build({
  configFile: false,
  publicDir: false,
  build: {
    ssr: 'src/online/worker.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
})

await writeFile('dist/.assetsignore', 'server/\n.openai/\n')

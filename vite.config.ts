import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import eslint from 'vite-plugin-eslint2'

// 移动文件
const moveFile = (sourcePath: string, targetPath: string) => {
  if (fs.existsSync(sourcePath)) {
    // 确保目标目录存在
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    // 移动文件
    fs.copyFileSync(sourcePath, targetPath)
    // 删除原文件和空目录
    fs.unlinkSync(sourcePath)
  }
}

const removeDir = (dirPath: string) => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    eslint({
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['node_modules', 'dist'],
      cache: false, // 禁用缓存以确保实时检查
      fix: false, // 开发时不自动修复，避免意外修改
      emitWarning: true, // 在终端显示警告
      emitError: true, // 在终端显示错误
    }),
    // 自定义插件来处理 HTML 文件输出
    {
      name: 'html-output-plugin',
      writeBundle(_options, bundle) {
        // 在写入完成后处理文件移动
        Object.keys(bundle).forEach(fileName => {
          if (fileName.includes('src/module/popup/index.html')) {
            const sourcePath = path.join('dist', fileName)
            const targetPath = path.join('dist', 'popup', 'index.html')
            moveFile(sourcePath, targetPath)
          } else if (fileName.includes('src/module/sidePanel/index.html')) {
            const sourcePath = path.join('dist', fileName)
            const targetPath = path.join('dist', 'sidePanel', 'index.html')
            moveFile(sourcePath, targetPath)
          }
        })
        removeDir('dist/src')
      },
    },
  ],
  css: {
    preprocessorOptions: {
      less: {
        additionalData: '@import "@/styles/global.less";',
        javascriptEnabled: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        'popup/index': './src/module/popup/index.html',
        'sidePanel/index': './src/module/sidePanel/index.html',
        'background/main': './src/module/background/main.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background/main') {
            return 'background/main.js'
          }
          return '[name]-[hash].js'
        },
        chunkFileNames: () => {
          // 如果chunk来自popup模块，输出到popup文件夹
          return 'chunks/[name]-[hash].js'
        },
        assetFileNames: () => {
          // 处理资源文件
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
    // 在开发模式下启用监听
    ...(mode === 'development' && {
      watch: {
        include: ['src/**'],
        exclude: ['node_modules/**', 'dist/**'],
      },
    }),
  },
}))

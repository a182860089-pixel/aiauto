# 图片识别网页端

浏览器端病例图片 OCR 与 Excel 导出项目。网页端通过 Vite 服务端代理调用 OCR 接口，并在本机生成下载文件。

```powershell
npm install
npm run dev
```

打开 Vite 显示的地址，上传图片、识别并导出 Excel。模板放在 `templates/`，生成文件放在 `ocr-output/`。

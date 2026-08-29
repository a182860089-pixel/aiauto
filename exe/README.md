# 病例自动传桌面版

Electron 桌面应用：OCR 识别病例图片、导出 Excel，并支持登录业务平台自动填入字段。

```powershell
npm install
npm run electron:dev
npm run dist:win
```

安装包输出到 `release/`。OCR 密钥通过桌面端本机设置保存，不写入项目源码。

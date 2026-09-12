# @env-butler/core

Env Keeper 的纯逻辑部分：解析与写回 `.env`、环境文件命名规则、方案与分组、Shell 片段的赋值分析与打码、快照命名、配置文件版本迁移。

不碰文件系统、不依赖 Raycast，输入输出都是字符串和普通对象，所以能单独跑测试。

## 装

```sh
npm install @env-butler/core
```

## 用

```ts
import { parseEnv, serializeEnv, isEnvFilename, isSecretKey } from "@env-butler/core";

const lines = parseEnv(await readFile(".env", "utf8"));
```

解析规则对齐 **dotenv v16**（`export` 前缀、`[\w.-]+` 变量名、无引号值 trim、反引号、双引号里 `\n` 展开、跨行引号……）——值最终是被 Vite / Next 这类工具经 dotenv 读走的，规则不一致会导致「界面显示的值 ≠ 程序拿到的值」。用 dotenv 16.6.1 逐例对照过。

## 开发

```sh
npm run check   # 类型检查 + 测试 + 构建
npm test        # vitest
```

> 扩展那边用 `file:` 依赖引这个包，**改完必须 `npm run build`**，否则扩展拿到的还是旧的 `dist/`。

## 许可

MIT

// 必须在所有读取 process.env 的模块（如 @/lib/db）之前导入本模块
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

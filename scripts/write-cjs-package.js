import { writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"

const path = "lib/cjs/package.json"
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, JSON.stringify({ type: "commonjs" }, null, 2) + "\n")

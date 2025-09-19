// Node.js equivalent of: echo '{"type": "commonjs"}' > lib/cjs/package.json
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const cjsPackageJsonPath = join("lib", "cjs", "package.json")
const cjsPackageJsonContent = JSON.stringify({ type: "commonjs" }) + "\n"
writeFileSync(cjsPackageJsonPath, cjsPackageJsonContent, "utf8")

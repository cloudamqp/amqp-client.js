import { rmSync } from "fs"
;["dist", "lib", "types"].forEach((dir) => {
  rmSync(dir, { recursive: true, force: true })
})

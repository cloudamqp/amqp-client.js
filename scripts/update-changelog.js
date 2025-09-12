#!/usr/bin/env node

import fs from "fs"

function main() {
  // Read package.json to get current version
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  const version = pkg.version

  console.log(`Updating changelog for version ${version}...`)

  // Read changelog
  let changelog = fs.readFileSync("CHANGELOG.md", "utf8")

  // Check if version already exists in changelog
  const today = new Date().toISOString().split("T")[0] // YYYY-MM-DD format
  const versionHeader = `## [${version}]`
  const newVersionHeader = `## [${version}] - ${today}`

  if (changelog.includes(newVersionHeader) || changelog.includes(versionHeader)) {
    console.log(`Version ${version} already exists in changelog. Skipping update.`)
    return
  }

  // Update [Unreleased] section to current version if it exists
  const unreleasedHeader = "## [Unreleased]"
  
  if (changelog.includes(unreleasedHeader)) {
    console.log("Updating [Unreleased] section to current version...")
    changelog = changelog.replace(unreleasedHeader, newVersionHeader)

    // Add a new [Unreleased] section at the top for future changes
    const changelogLines = changelog.split("\n")
    const headerIndex = changelogLines.findIndex((line) => line.startsWith("## ["))
    if (headerIndex !== -1) {
      changelogLines.splice(headerIndex, 0, "## [Unreleased]", "")
      changelog = changelogLines.join("\n")
    }

    // Write updated changelog back to file
    fs.writeFileSync("CHANGELOG.md", changelog, "utf8")
    console.log("✅ Updated CHANGELOG.md")
  } else {
    console.log("No [Unreleased] section found in changelog.")
  }
}

main()
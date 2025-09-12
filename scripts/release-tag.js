#!/usr/bin/env node

import fs from "fs"
import { execSync } from "child_process"

function main() {
  // Check if we should only update changelog (no tag creation)
  const updateChangelogOnly = process.argv.includes("--update-changelog")
  
  // Read package.json to get current version
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  const version = pkg.version

  if (updateChangelogOnly) {
    console.log(`Updating changelog for version ${version}...`)
  } else {
    console.log(`Creating tag for version ${version}...`)
  }

  // Read changelog
  let changelog = fs.readFileSync("CHANGELOG.md", "utf8")

  // Update [Unreleased] section to current version if it exists
  const unreleasedHeader = "## [Unreleased]"
  const versionHeader = `## [${version}]`
  const today = new Date().toISOString().split("T")[0] // YYYY-MM-DD format
  const newVersionHeader = `## [${version}] - ${today}`

  // Check if version already exists in changelog
  if (changelog.includes(newVersionHeader) || changelog.includes(versionHeader)) {
    console.log(`Version ${version} already exists in changelog. Skipping update.`)
  } else if (changelog.includes(unreleasedHeader)) {
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
  }

  // If only updating changelog, exit here (don't create tag)
  if (updateChangelogOnly) {
    return
  }

  // Find the section for this version
  const startIdx =
    changelog.indexOf(newVersionHeader) !== -1 ? changelog.indexOf(newVersionHeader) : changelog.indexOf(versionHeader)

  if (startIdx === -1) {
    console.error(`Error: Version ${version} not found in CHANGELOG.md`)
    process.exit(1)
  }

  // Find the next version section to know where this version's content ends
  const nextVersionIdx = changelog.indexOf("\n## [", startIdx + 1)

  // Extract the content for this version
  const content = changelog.substring(startIdx, nextVersionIdx === -1 ? undefined : nextVersionIdx).trim()

  console.log("Changelog content:")
  console.log(content)
  console.log()

  // Create the git tag with the changelog content as the message
  const tagName = `v${version}`

  // Check if tag already exists
  try {
    execSync(`git rev-parse ${tagName}`, { stdio: "pipe" })
    console.log(`⚠️  Tag ${tagName} already exists. Skipping tag creation.`)
    return
  } catch {
    // Tag doesn't exist, continue with creation
  }

  // Escape backticks and other shell special characters in the content
  const escapedContent = content.replace(/`/g, "\\`").replace(/\$/g, "\\$")

  try {
    execSync(`git tag -a ${tagName} -m ${JSON.stringify(escapedContent)}`, {
      stdio: "inherit",
    })
    console.log(`✅ Created tag ${tagName} successfully`)
  } catch (error) {
    console.error(`❌ Failed to create tag: ${error.message}`)
    process.exit(1)
  }
}

main()

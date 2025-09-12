#!/usr/bin/env node

import fs from "fs"
import { execSync } from "child_process"

function main() {
  // Read package.json to get current version
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  const version = pkg.version

  console.log(`Creating tag for version ${version}...`)

  // Read changelog
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8")

  // Find the section for this version
  const versionHeader = `## [${version}]`
  const startIdx = changelog.indexOf(versionHeader)

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

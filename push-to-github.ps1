# Script to push changes to GitHub (run from external terminal outside Cursor)
# This avoids Cursor's Git extension creating lock files
# 
# USAGE: 
#   .\push-to-github.ps1
#   OR
#   .\push-to-github.ps1 -Message "Custom commit message here"
#
# If no message is provided, one will be auto-generated from the changes

param(
    [Parameter(Position=0)]
    [string]$Message
)

$repoPath = "D:\Invoice Portal 2025"
Set-Location $repoPath

# Function to generate commit message from file changes
function Generate-CommitMessage {
    param([array]$Files)
    
    if (-not $Files -or $Files.Count -eq 0) {
        return "Update files"
    }
    
    $components = @()
    $pages = @()
    $other = @()
    
    foreach ($file in $Files) {
        if ($file -match "components[/\\]") {
            $name = $file -replace ".*[/\\]([^/\\]+)$", '$1' -replace "\.js$", ""
            $components += $name
        } elseif ($file -match "pages[/\\]") {
            $name = $file -replace ".*[/\\]([^/\\]+)$", '$1' -replace "\.js$", ""
            $pages += $name
        } else {
            $other += $file
        }
    }
    
    $parts = @()
    
    if ($components.Count -gt 0) {
        if ($components.Count -eq 1) {
            $parts += "Update $($components[0]) component"
        } else {
            $parts += "Update components: $($components -join ', ')"
        }
    }
    
    if ($pages.Count -gt 0) {
        if ($pages.Count -eq 1) {
            $parts += "Update $($pages[0]) page"
        } else {
            $parts += "Update pages: $($pages -join ', ')"
        }
    }
    
    if ($other.Count -gt 0) {
        $otherFiles = $other | ForEach-Object { 
            $_ -replace ".*[/\\]([^/\\]+)$", '$1' 
        }
        if ($otherFiles.Count -eq 1) {
            $parts += "Update $($otherFiles[0])"
        } else {
            $parts += "Update files: $($otherFiles -join ', ')"
        }
    }
    
    if ($parts.Count -eq 0) {
        return "Update files"
    }
    
    return $parts -join " | "
}

# Remove any existing lock files
Write-Host "Removing lock files..." -ForegroundColor Yellow
Remove-Item -Path ".git\index.lock" -Force -ErrorAction SilentlyContinue
Remove-Item -Path ".git\config.lock" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Check if lock file still exists
if (Test-Path ".git\index.lock") {
    Write-Host "ERROR: Lock file still exists. Please close Cursor and try again." -ForegroundColor Red
    exit 1
}

# Check for changes (modified, staged, AND untracked files)
Write-Host "Checking for changes..." -ForegroundColor Yellow
$modifiedFiles = git diff --name-only
$stagedFiles = git diff --cached --name-only
$untrackedFiles = git ls-files --others --exclude-standard
$allChangedFiles = @()
if ($modifiedFiles) { $allChangedFiles += $modifiedFiles }
if ($stagedFiles) { $allChangedFiles += $stagedFiles }
if ($untrackedFiles) { $allChangedFiles += $untrackedFiles }
$hasChanges = ($modifiedFiles -or $stagedFiles -or $untrackedFiles)

# Auto-generate commit message if not provided
if ($hasChanges -and [string]::IsNullOrWhiteSpace($Message)) {
    $commitMessage = Generate-CommitMessage -Files $allChangedFiles
    Write-Host "`nAuto-generated commit message:" -ForegroundColor Cyan
    Write-Host "  $commitMessage" -ForegroundColor White
} elseif (-not [string]::IsNullOrWhiteSpace($Message)) {
    $commitMessage = $Message
    Write-Host "`nUsing provided commit message:" -ForegroundColor Cyan
    Write-Host "  $commitMessage" -ForegroundColor White
}

if ($hasChanges) {
    Write-Host "`nFiles to be committed:" -ForegroundColor Cyan
    if ($modifiedFiles) {
        $modifiedFiles | ForEach-Object { Write-Host "  Modified: $_" -ForegroundColor Yellow }
    }
    if ($stagedFiles) {
        $stagedFiles | ForEach-Object { Write-Host "  Staged: $_" -ForegroundColor Yellow }
    }
    if ($untrackedFiles) {
        $untrackedFiles | ForEach-Object { Write-Host "  New: $_" -ForegroundColor Green }
    }
    Write-Host ""
}

if (-not $hasChanges) {
    Write-Host "No changes to commit." -ForegroundColor Yellow
    Write-Host "Checking if there are unpushed commits..." -ForegroundColor Yellow
    $unpushed = git log origin/main..HEAD --oneline
    if ($unpushed) {
        Write-Host "Found unpushed commits, pushing..." -ForegroundColor Yellow
        git push origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SUCCESS: Unpushed commits pushed to GitHub!" -ForegroundColor Green
        } else {
            Write-Host "ERROR: Failed to push" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Everything is up to date." -ForegroundColor Green
    }
    exit 0
}

# Stage all changes (modified, deleted, AND new untracked files)
Write-Host "Staging changes..." -ForegroundColor Yellow
git add -A

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to stage changes" -ForegroundColor Red
    exit 1
}

# Commit the changes
Write-Host "Committing changes..." -ForegroundColor Yellow
if (-not $commitMessage) {
    Write-Host "ERROR: No commit message available!" -ForegroundColor Red
    exit 1
}
git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to commit changes" -ForegroundColor Red
    exit 1
}

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "SUCCESS: Changes pushed to GitHub!" -ForegroundColor Green
} else {
    Write-Host "ERROR: Failed to push to GitHub" -ForegroundColor Red
    exit 1
}

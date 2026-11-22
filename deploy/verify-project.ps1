$ErrorActionPreference = 'Stop'
$PitWallProject = 'f1-pitwall-2026-qh719'
$ProjectRecord = gcloud projects describe $PitWallProject --project=$PitWallProject --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $ProjectRecord.projectId -cne $PitWallProject -or $ProjectRecord.projectNumber -ne '649091037888') {
    throw 'F1 PitWall project identity verification failed. No deployment is authorized.'
}
Write-Host "Verified F1 PitWall project: $($ProjectRecord.projectId) / $($ProjectRecord.projectNumber)"

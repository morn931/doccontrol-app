# Run the prelim quality check over every open session, one after the other.
# Usage: pwsh scripts/prelim-quality-all.ps1
$ErrorActionPreference = 'Continue'
$ids = @(
  '3bee706b-bdeb-40d3-beec-7029c71bde05', # Main Consumer
  'd3a1c747-e097-418f-9f43-bfc58eb041fb', # Mining
  '5904220a-058d-4dc9-924b-59bded4ccad8', # Main Intake
  '47ee7674-08d4-4035-b77a-aaf59fb9adb0', # Solar PV
  '82e6e3af-aa6c-4aa9-a496-7fc75ba03341'  # Site Wide
)
foreach ($id in $ids) { node scripts/prelim-quality-run.mjs $id 2>&1 | Where-Object { $_ -notmatch 'Assertion failed' } }

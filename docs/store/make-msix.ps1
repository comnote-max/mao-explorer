# Microsoft Store 提出用の MSIX を作る（署名は Store 側で行うので不要）
# 値は Partner Center の「製品の ID（Product identity）」に表示されるものを使う:
#   -IdentityName      例: 12345maociva.MAOExplorer
#   -Publisher         例: CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
#   -PublisherName     例: maociva
# 使い方: powershell -File docs\store\make-msix.ps1 -IdentityName ... -Publisher "CN=..." -PublisherName maociva
param(
  [Parameter(Mandatory)] [string]$IdentityName,
  [Parameter(Mandatory)] [string]$Publisher,
  [Parameter(Mandatory)] [string]$PublisherName,
  [string]$Version = "0.1.0.0"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$exe = Join-Path $root "target\release\mao-explorer.exe"
if (-not (Test-Path $exe)) { throw "先に npm run tauri build で配布版を作ってください: $exe" }
$makeappx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter makeappx.exe | Where-Object FullName -like "*\x64\*" | Select-Object -Last 1 -ExpandProperty FullName
if (-not $makeappx) { throw "Windows SDK の makeappx.exe が見つかりません" }

$stage = Join-Path $root "target\release\bundle\msix\stage"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$stage\Assets" | Out-Null
Copy-Item $exe "$stage\MAOExplorer.exe"

# アイコン（ストアのタイル用）をアプリのアイコンから作る
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Join-Path $root "src-tauri\icons\icon.png"))
foreach ($a in @(@("StoreLogo.png", 50), @("Square44x44Logo.png", 44), @("Square150x150Logo.png", 150), @("Square310x310Logo.png", 310))) {
  $bmp = New-Object System.Drawing.Bitmap $a[1], $a[1]
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = "HighQualityBicubic"; $g.DrawImage($src, 0, 0, $a[1], $a[1]); $g.Dispose()
  $bmp.Save("$stage\Assets\$($a[0])", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$wide = New-Object System.Drawing.Bitmap 310, 150
$g = [System.Drawing.Graphics]::FromImage($wide); $g.Clear([System.Drawing.Color]::Transparent); $g.InterpolationMode = "HighQualityBicubic"; $g.DrawImage($src, 105, 5, 140, 140); $g.Dispose()
$wide.Save("$stage\Assets\Wide310x150Logo.png", [System.Drawing.Imaging.ImageFormat]::Png); $wide.Dispose(); $src.Dispose()

@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$Version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>MAO Explorer</DisplayName>
    <PublisherDisplayName>$PublisherName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="ja-JP" /><Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="MAOExplorer" Executable="MAOExplorer.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="MAO Explorer" Description="GitHub をふつうのフォルダのように使えるファイラー"
        BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" Square310x310Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@ | Set-Content -Path "$stage\AppxManifest.xml" -Encoding utf8

$out = Join-Path $root "target\release\bundle\msix\MAO-Explorer_$Version`_x64.msix"
& $makeappx pack /d $stage /p $out /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx に失敗しました" }
Write-Host "作成しました: $out"

Add-Type -AssemblyName System.Windows.Forms
$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$topForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$topForm.Show()
$topForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
$topForm.BringToFront()

$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "请选择你的代码项目工作区根目录"
$f.ShowNewFolderButton = $true
$res = $f.ShowDialog($topForm)
$topForm.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $f.SelectedPath
}
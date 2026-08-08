$ErrorActionPreference = "Stop"

$AppPath = "C:\DevProjects\smart-menu-frontend\src\App.jsx"
$BackupPath = "C:\DevProjects\smart-menu-frontend\src\App.jsx.backup-linehub"

if (!(Test-Path $AppPath)) {
    throw "找不到 $AppPath"
}

Copy-Item $AppPath $BackupPath -Force
Write-Host "已備份到: $BackupPath"

$text = Get-Content $AppPath -Raw -Encoding UTF8

# 1. 移除全域 NAVIGATION 的 LINE Hub
$text = [regex]::Replace(
    $text,
    "(?m)^\s*\{\s*id:\s*'linehub',\s*label:\s*'LINE OA / Webhook Hub',\s*icon:\s*Link\s*\},\s*\r?\n",
    ""
)

# 2. MembersView 改成可以進入帳號
$text = $text.Replace(
    "const MembersView = () => {",
    "const MembersView = ({ onOpenAccount }) => {"
)

# 3. 成員列加入「進入帳號」按鈕（只插一次）
if ($text -notmatch "進入帳號") {
    $old = @'
                    {!isOwner && (
                      <button
                        onClick={() => deleteMember(member)}
                        className="border border-red-200 hover:bg-red-50 text-red-600 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        移除
                      </button>
                    )}

                    <span className="text-xs text-gray-400 min-w-[56px] text-right">
'@

    $new = @'
                    <button
                      onClick={() => onOpenAccount?.(member)}
                      className="border border-blue-200 hover:bg-blue-50 text-blue-600 px-3 py-2 rounded-md text-sm font-medium"
                    >
                      進入帳號
                    </button>

                    {!isOwner && (
                      <button
                        onClick={() => deleteMember(member)}
                        className="border border-red-200 hover:bg-red-50 text-red-600 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        移除
                      </button>
                    )}

                    <span className="text-xs text-gray-400 min-w-[56px] text-right">
'@

    if ($text.Contains($old)) {
        $text = $text.Replace($old, $new)
    } else {
        Write-Warning "找不到成員操作區塊，未插入「進入帳號」按鈕。"
    }
}

# 4. LineHubView 改成帳號內頁
$text = $text.Replace(
    "const LineHubView = () => {",
    "const LineHubView = ({ member, onBack }) => {"
)

# 5. App 加 selectedMember state
if ($text -notmatch "selectedMember") {
    $text = $text.Replace(
        "  const [currentProjectId, setCurrentProjectId] = useState(null);",
        "  const [currentProjectId, setCurrentProjectId] = useState(null);`r`n  const [selectedMember, setSelectedMember] = useState(null);"
    )
}

# 6. 團隊成員 render 改成帶進入帳號
$text = $text.Replace(
    "{currentView === 'members' && <MembersView />}",
@'
{currentView === 'members' && (
              <MembersView
                onOpenAccount={(member) => {
                  setSelectedMember(member);
                  setCurrentView('member-linehub');
                }}
              />
            )}
'@
)

# 7. 全域 linehub render 改成 member-linehub
$text = $text.Replace(
    "{currentView === 'linehub' && <LineHubView />}",
@'
{currentView === 'member-linehub' && (
              <LineHubView
                member={selectedMember}
                onBack={() => {
                  setSelectedMember(null);
                  setCurrentView('members');
                }}
              />
            )}
'@
)

# 8. 若還有全域 linehub 判斷，一律改 scoped
$text = $text.Replace("currentView === 'linehub'", "currentView === 'member-linehub'")

Set-Content $AppPath -Value $text -Encoding UTF8

Write-Host ""
Write-Host "修補完成。驗證結果："
Select-String -Path $AppPath -Pattern "id: 'linehub'|member-linehub|進入帳號"

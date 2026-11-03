param([string]$FunctionName, [string]$WorkspaceRoot, [int]$DefaultTimeout = 120000, [int]$OutputLimit = 65536, [int]$TransferTtl = 120000, [int]$ChunkBytes = 32768)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'unsupported_host_platform: This release requires a Windows Host.' }
if ($FunctionName -notmatch '^Invoke_Lswb_[a-f0-9]{32}$') { throw 'invalid_host_function' }
if (-not ('LswbHostV020.Job' -as [type])) {
    $runtimeSource = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RUNTIME_BASE64__'))
    Add-Type -TypeDefinition $runtimeSource -Language CSharp
}
$resolvedRoot = [IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) { throw 'host_root_not_found' }
$sessionState = @{ Root=$resolvedRoot; Jobs=@{}; Uploads=@{}; Readers=@{}; DefaultTimeout=$DefaultTimeout; OutputLimit=$OutputLimit; TransferTtl=$TransferTtl; ChunkBytes=$ChunkBytes; FunctionName=$FunctionName }
$handler = {
    param([string]$Payload, [string]$Nonce, [switch]$ReadInput)
    $ErrorActionPreference = 'Stop'
#__LSWB_HOST_CORE__#
    if($Nonce -notmatch '^[a-f0-9]{32}$'){return}
    try {
        if($ReadInput){[Console]::WriteLine("`n"+'LSWB_READY:'+$Nonce);$Payload=[LswbHostV020.Util]::ReadPayload(15000)}
        $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
        if($request.requestNonce -ne $Nonce){Fail 'nonce_mismatch' 'Host request and output frame do not match.'}
        Assert-InspectionLimit $request
        $result=Process-Request $request
        Add-TextStates $request $result
        $reply=@{ok=$true;result=$result}
    } catch {
        $reply=Get-ErrorReply $_
    }
    $json=$reply|ConvertTo-Json -Compress -Depth 30
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    [Console]::WriteLine("`n"+'LSWB_RESULT:'+$Nonce+':')
    for($offset=0;$offset -lt $encoded.Length;$offset+=1024){
        [Console]::WriteLine($encoded.Substring($offset,[Math]::Min(1024,$encoded.Length-$offset)))
        # Yield between bounded bursts so a shared-terminal renderer can acknowledge output.
        if(($offset % 4096) -eq 3072){[Threading.Thread]::Sleep(5)}
    }
    [Console]::WriteLine('LSWB_END:'+$Nonce)
}.GetNewClosure()
Set-Item -Path ('Function:\global:'+$FunctionName) -Value $handler

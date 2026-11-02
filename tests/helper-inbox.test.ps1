$ErrorActionPreference='Stop'
$helperText=[IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'sync\LegacySync.ps1'))
$fn=[regex]::Match($helperText,'(?ms)^function Add-InboxRecords\(.*?\r?\n\}')
if(-not $fn.Success){throw 'Could not extract Add-InboxRecords from candidate uploader'}
Invoke-Expression $fn.Value
$ErrorActionPreference='Stop'
function Get-RecordsFromNode($node) { $list=New-Object 'System.Collections.Generic.List[object]'; Add-InboxRecords $node $list; return ,$list.ToArray() }
function Get-RecordsFromJson([string]$json) { $node=ConvertFrom-Json -InputObject $json; return ,(Get-RecordsFromNode $node) }
function Test-Wrapper($node) { if($node -isnot [System.Management.Automation.PSCustomObject]){return $false}; $props=@($node.PSObject.Properties.Name); $cnt=0; return ($props.Count -eq 2 -and $props -contains 'value' -and $props -contains 'Count' -and -not $node.PSObject.Properties['id'] -and $node.value -is [array] -and [int]::TryParse([string]$node.Count,[ref]$cnt) -and $cnt -eq $node.value.Count) }
function Get-WrappedTopCount([string]$json) { $node=ConvertFrom-Json -InputObject $json; if($node -is [array]){$arr=$node}elseif($null -eq $node){$arr=@()}else{$arr=@($node)}; $count=0; foreach($x in $arr){if(Test-Wrapper $x){$count++}}; return $count }
function Add-Wrapper($records) { $n=@($records).Count; return [pscustomobject]@{value=@($records);Count=$n} }
function Apply-Fixed([string]$oldJson,$incoming) { $old=Get-RecordsFromJson $oldJson; $new=Get-RecordsFromNode $incoming; $all=@(@($old)+@($new)|Select-Object -Last 40); return ConvertTo-Json -InputObject $all -Depth 8 -Compress }
function Apply-Original([string]$oldJson,$incoming,[bool]$hasPrior) { $old=@(); if($hasPrior){$path=Join-Path $env:TEMP ('tg-inbox-'+[guid]::NewGuid().ToString('N')+'.json'); [IO.File]::WriteAllText($path,$oldJson,(New-Object System.Text.UTF8Encoding $false)); $old=@([IO.File]::ReadAllText($path,(New-Object System.Text.UTF8Encoding $false))|ConvertFrom-Json)}; $all=@(@($old)+@($incoming)|Select-Object -Last 40); return ConvertTo-Json -InputObject $all -Depth 8 -Compress }
function New-Message([string]$id,[string]$act) { return [pscustomobject]@{id=$id;kind='chaos';act=$act;from='test';text=('text-'+$id);at=123;extra=[pscustomobject]@{keep='yes'}} }
$matrix=@()
foreach($pc in 0,1,3){foreach($ic in 0,1,3){
 $prior=@();for($i=1;$i -le $pc;$i++){$prior+=New-Message ('p'+$i) 'tax'}
 $incoming=@();for($i=1;$i -le $ic;$i++){$incoming+=New-Message ('i'+$i) 'gift'}
 $priorJson=ConvertTo-Json -InputObject $prior -Depth 8 -Compress
 if($ic -eq 0){$brokenJson=$priorJson;$fixedJson=$priorJson}else{$brokenJson=Apply-Original $priorJson $incoming ($pc -gt 0);$fixedJson=Apply-Fixed $priorJson $incoming}
 $expected=@($prior|ForEach-Object{$_.id})+@($incoming|ForEach-Object{$_.id})
 $fixedRecords=Get-RecordsFromJson $fixedJson
 $matrix += [pscustomobject]@{prior=$pc;incoming=$ic;original_wrapped_top_entries=(Get-WrappedTopCount $brokenJson);fixed_wrapped_top_entries=(Get-WrappedTopCount $fixedJson);fixed_count=$fixedRecords.Count;fixed_ids_preserved=((@($fixedRecords|ForEach-Object{$_.id}) -join ',') -eq ($expected -join ','));unknown_fields_preserved=(@($fixedRecords|Where-Object{$_.extra.keep -eq 'yes'}).Count -eq $fixedRecords.Count)}
}}
# Synthetic sample matching the observed legacy wrapper shape; no private fixture data.
$sampleTax=New-Message 'prior-tax' 'tax'
$sampleGift=New-Message 'incoming-gift' 'gift'
$sampleJson=ConvertTo-Json -InputObject @((Add-Wrapper @($sampleTax)),$sampleGift) -Depth 8 -Compress
$sampleRecords=Get-RecordsFromJson $sampleJson
$sampleTaxOut=@($sampleRecords|Where-Object{$_.act -eq 'tax'})|Select-Object -First 1
$sampleGiftOut=@($sampleRecords|Where-Object{$_.act -eq 'gift'})|Select-Object -First 1
$sample=[pscustomobject]@{input_top_wrappers=(Get-WrappedTopCount $sampleJson);output_records=$sampleRecords.Count;tax_and_gift_ids_preserved=([bool]$sampleTaxOut.id -and [bool]$sampleGiftOut.id);unknown_tax_text_preserved=([bool]$sampleTaxOut.text -and [bool]$sampleTaxOut.at);no_wrappers_in_fixed_output=((Get-WrappedTopCount (ConvertTo-Json -InputObject $sampleRecords -Depth 8 -Compress)) -eq 0)}
# Nested actual wrapper tests, including a message with value+Count fields and an id (must not unwrap).
$msg=New-Message 'nested-id' 'gift'; $w1=Add-Wrapper @($msg); $w2=Add-Wrapper @($w1); $w3=Add-Wrapper @($w2)
$nestedJson=ConvertTo-Json -InputObject @($w3) -Depth 12 -Compress
$nestedRecords=Get-RecordsFromJson $nestedJson
$legit=New-Message 'legit-value-count' 'gift'; $legit | Add-Member -NotePropertyName value -NotePropertyValue @('payload'); $legit | Add-Member -NotePropertyName Count -NotePropertyValue 1
$guarded=Get-RecordsFromNode @($legit)
$mismatch=[pscustomobject]@{value=@((New-Message 'must-not-leak' 'tax'));Count=2}
$badNode=@((New-Message 'valid-next' 'gift'),$mismatch,'not-a-message',[pscustomobject]@{kind='chaos';act='tax'})
$rejectRecords=Get-RecordsFromNode $badNode
# Flatten before the existing last-40 cap.
$many=@();for($i=1;$i -le 41;$i++){$many += New-Message ('m'+$i) 'gift'}
$wrappedMany=Add-Wrapper $many
$capJson=Apply-Fixed (ConvertTo-Json -InputObject @($wrappedMany) -Depth 10 -Compress) @((New-Message 'last' 'gift'))
$capRecords=Get-RecordsFromJson $capJson
$result=[pscustomobject]@{runtime=$PSVersionTable.PSVersion.ToString();local_only=$true;matrix_cases=$matrix.Count;matrix=$matrix;actual_sample=$sample;nested_wrappers=[pscustomobject]@{input_depth=3;output_records=$nestedRecords.Count;id_preserved=($nestedRecords.Count -eq 1 -and $nestedRecords[0].id -eq 'nested-id');unknown_fields_preserved=($nestedRecords.Count -eq 1 -and $nestedRecords[0].extra.keep -eq 'yes')};guardrails=[pscustomobject]@{legitimate_value_count_message_preserved=($guarded.Count -eq 1 -and $guarded[0].id -eq 'legit-value-count');malformed_nonmessage_rejected=($rejectRecords.Count -eq 1 -and $rejectRecords[0].id -eq 'valid-next')};cap40=[pscustomobject]@{count=$capRecords.Count;first_is_m3=($capRecords.Count -eq 40 -and $capRecords[0].id -eq 'm3');last_is_new=($capRecords.Count -eq 40 -and $capRecords[39].id -eq 'last')}}
$out=Join-Path $PSScriptRoot 'public-test-record.json'; [IO.File]::WriteAllText($out,($result|ConvertTo-Json -Depth 12),(New-Object System.Text.UTF8Encoding $false)); Get-Content -LiteralPath $out -Raw
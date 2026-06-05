' Module: Arnold
'==============================================================================
' Arnold Quote Sync  (universal: macOS + Windows)
'------------------------------------------------------------------------------
' Extracts quote data from the active quote sheet and pushes it to the Arnold
' web app CRM, driving the Concept -> Proposal -> Revision pipeline from Excel.
'
' No API key. The macro talks to dedicated public backend endpoints:
'     GET  /api/crm/excel/quote?quoteNumber=...   (look up current stage)
'     POST /api/crm/excel/quote/sync              (advance + update the quote)
'
' SETUP (one time):
'   1. Excel > Developer > Visual Basic > File > Import File... and pick this
'      file (Arnold.bas). It appears under "Modules".
'   2. Ensure UserForm "ArnoldSyncQuoteForm" already exists in PERSONAL.XLSB
'      (stored component, not generated at runtime).
'   3. (Optional) Confirm API_BASE_URL below matches your environment.
'   4. Add a button to the quote sheet: Developer > Insert > Button (Form
'      Control). Draw it, then assign macro "SyncQuoteToConcept".
'
' Cross-platform: HTTP uses WinHttp on Windows and curl on macOS, selected at
' compile time via #If Mac. The same file works on both. On macOS the first run
' may ask permission for Excel to run a shell command (curl) - allow it.
'==============================================================================

Option Explicit

' ---- Configuration ---------------------------------------------------------
Private Const API_BASE_URL As String = "https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1"

' Shared secret that authorizes this macro with the backend. Must match the
' EXCEL_SYNC_TOKEN env var on the server. This is NOT an API key - it is a
' single static code; anyone with this file can sync, nobody else can. To
' rotate it, change it here and in the server's .env, then redeploy.
Private Const SYNC_TOKEN As String = "xsync_463929fb56c000a19f8963a54a5c16f6a81bc14fbc187724"

' ---- Quote sheet layout ---------------------------------------------------
' Header positions are based on the current Arnold quote template. The quote
' number is expected in H2 and the project name in H3. Some exported copies of
' the same template have the quote number one row higher and the project name in
' the merged Project value area, so the extraction code below includes fallbacks.
Private Const ROW_QUOTE_NUMBER As Long = 2
Private Const COL_QUOTE_NUMBER As Long = 8    ' H
Private Const ROW_QUOTE_NUMBER_FALLBACK As Long = 1
Private Const ROW_PROJECT_NAME As Long = 3
Private Const COL_PROJECT_NAME As Long = 8    ' H
Private Const COL_PROJECT_NAME_FALLBACK As Long = 6 ' F in exported sample

Private Const ROW_DATE As Long = 6
Private Const ROW_COMPANY As Long = 7
Private Const ROW_CONTACT_NAME As Long = 8
Private Const ROW_CONTACT_EMAIL As Long = 9
Private Const ROW_CONTACT_PHONE As Long = 10
Private Const ROW_SALES_REP As Long = 11
Private Const ROW_LEAD_TIME As Long = 12
Private Const ROW_PAYMENT_TERMS As Long = 13
Private Const COL_LABEL_VALUE As Long = 3     ' C; merged through F in the template

Private Const ROW_LINE_ITEMS_START As Long = 18
Private Const COL_ITEM As Long = 1            ' A
Private Const COL_DESCRIPTION As Long = 2     ' B; merged through F for item descriptions
Private Const COL_QTY As Long = 7             ' G
Private Const COL_UNIT_PRICE As Long = 8      ' H
Private Const COL_EXT_PRICE As Long = 9       ' I
Private Const COL_TOTAL_LABEL As Long = 7     ' G; merged through H for Sub Net Total / Net

' ---- JSON parser state (module-level; must be declared before any procedure) ----
Private mJson As String
Private mPos As Long
Private mLen As Long

' ---- Unified confirmation form state --------------------------------------
Private Const SYNC_FORM_COMPONENT_NAME As String = "ArnoldSyncQuoteForm"

Private mSyncDialogQuoteNumber As String
Private mSyncDialogProjectName As String
Private mSyncDialogCompanyName As String
Private mSyncDialogContactName As String
Private mSyncDialogContactEmail As String
Private mSyncDialogContactPhone As String
Private mSyncDialogQuoteDateDisplay As String
Private mSyncDialogLeadTime As String
Private mSyncDialogPaymentTerm As String
Private mSyncDialogSubtotal As Double
Private mSyncDialogHasSubtotal As Boolean
Private mSyncDialogFreight As Double
Private mSyncDialogHasFreight As Boolean
Private mSyncDialogFreightDesc As String
Private mSyncDialogLineItemCount As Long
Private mSyncDialogPromptText As String

Private mSyncDialogStateOptions As Collection
Private mSyncDialogSalesRepOptions As Collection
Private mSyncDialogProjectTypeOptions As Collection

Private mSyncDialogDefaultStateOption As String
Private mSyncDialogDefaultSalesRep As String
Private mSyncDialogDefaultProjectType As String

Private mSyncDialogSelectedDealerState As String
Private mSyncDialogSelectedSalesRep As String
Private mSyncDialogSelectedProjectType As String
Private mSyncDialogAccepted As Boolean
Private mSyncDialogFilterBusy As Boolean

'==============================================================================
' Button entry point
'==============================================================================
Public Sub SyncQuoteToConcept()
    On Error GoTo Fail

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ' ---- Extract header fields ----
    Dim quoteNumber As String, projectName As String, companyName As String
    Dim contactName As String, contactEmail As String, contactPhone As String
    Dim salesRep As String, leadTime As String, paymentTerms As String
    Dim quoteDateIso As String, quoteDateDisplay As String

    quoteNumber = CellText(ws, ROW_QUOTE_NUMBER, COL_QUOTE_NUMBER)
    If Len(quoteNumber) = 0 Then quoteNumber = CellText(ws, ROW_QUOTE_NUMBER_FALLBACK, COL_QUOTE_NUMBER)
    quoteNumber = NormalizeQuoteNumberForSync(quoteNumber)

    projectName = CellText(ws, ROW_PROJECT_NAME, COL_PROJECT_NAME)
    If Len(projectName) = 0 Then projectName = CellText(ws, ROW_PROJECT_NAME, COL_PROJECT_NAME_FALLBACK)

    companyName = CellText(ws, ROW_COMPANY, COL_LABEL_VALUE)
    contactName = CellText(ws, ROW_CONTACT_NAME, COL_LABEL_VALUE)
    contactEmail = CellText(ws, ROW_CONTACT_EMAIL, COL_LABEL_VALUE)
    contactPhone = CellText(ws, ROW_CONTACT_PHONE, COL_LABEL_VALUE)
    salesRep = CellText(ws, ROW_SALES_REP, COL_LABEL_VALUE)
    leadTime = CellText(ws, ROW_LEAD_TIME, COL_LABEL_VALUE)
    paymentTerms = CellText(ws, ROW_PAYMENT_TERMS, COL_LABEL_VALUE)

    quoteDateIso = CellDateIso(ws, ROW_DATE, COL_LABEL_VALUE)
    quoteDateDisplay = CellText(ws, ROW_DATE, COL_LABEL_VALUE)

    If Len(quoteNumber) = 0 Then
        MsgBox "No quote number found in cell H2. Cannot continue.", _
               vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    ' ---- Extract line items + totals ----
    Dim lineItemsJson As String
    Dim lineItemCount As Long
    lineItemsJson = BuildLineItemsJson(ws, lineItemCount)

    Dim subtotal As Double, freight As Double
    Dim hasSubtotal As Boolean, hasFreight As Boolean
    Dim freightDescription As String
    subtotal = FindSubtotal(ws, hasSubtotal)
    FindFreightInfo ws, freight, freightDescription, hasFreight

    ' totalAmount is the all-in quote value. Freight is kept as its own field
    ' (never folded into subtotal), but the headline total includes it.
    Dim totalAmount As Double
    totalAmount = subtotal + freight

    ' ---- Look up the quote in the CRM by quote number ----
    Dim getUrl As String
    getUrl = API_BASE_URL & "/api/crm/excel/quote?quoteNumber=" & UrlEncode(quoteNumber)

    Dim getStatus As Long, getBody As String
    getBody = HttpSend("GET", getUrl, "", getStatus)

    If getStatus < 200 Or getStatus >= 300 Then
        MsgBox "Could not search for the quote (HTTP " & getStatus & ")." & vbCrLf & vbCrLf & _
               Left$(getBody, 600), vbCritical, "Arnold Quote Sync"
        Exit Sub
    End If

    Dim lookup As Object
    Set lookup = JsonParse(getBody)

    Dim found As Boolean
    found = (LCase$(NzStr(JsonGet(lookup, "found"))) = "true")

    ' Decision A: not found anywhere
    If Not found Then
        MsgBox "Quote number " & quoteNumber & " was not found in Concept. " & _
               "Please add it to the Concept column on the website first, then try again.", _
               vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    Dim stage As String
    stage = LCase$(NzStr(JsonGet(lookup, "opportunityStage")))
    If Len(stage) = 0 Then stage = "concept"

    Select Case stage
        Case "concept", "proposal_submission", "revision"
            ' Supported by this macro.
        Case Else
            MsgBox "Quote " & quoteNumber & " is in stage '" & stage & "', which this " & _
                   "tool does not manage. No changes were made.", _
                   vbInformation, "Arnold Quote Sync"
            Exit Sub
    End Select

    ' ---- Single-screen confirmation options ----
    Dim stateOptions As Collection
    Dim salesRepOptions As Collection
    Dim projectTypeOptions As Collection

    Set stateOptions = BuildDealerStateOptions()
    Set salesRepOptions = BuildSalesRepOptions()
    Set projectTypeOptions = BuildProjectTypeOptions()

    Dim dealerState As String
    Dim projectType As String
    Dim defaultStateOption As String
    Dim defaultSalesRep As String
    Dim defaultProjectType As String
    Dim proceed As Boolean

    defaultStateOption = ResolveDefaultOption(NzStr(JsonGet(lookup, "dealerState")), stateOptions)

    defaultSalesRep = ResolveDefaultOption(salesRep, salesRepOptions)
    If Len(defaultSalesRep) = 0 Then defaultSalesRep = "House"

    defaultProjectType = ResolveDefaultOption(NzStr(JsonGet(lookup, "projectType")), projectTypeOptions)
    If Len(defaultProjectType) = 0 Then
        defaultProjectType = ResolveDefaultOption(InferProjectTypeFromProjectName(projectName), projectTypeOptions)
    End If
    If Len(defaultProjectType) = 0 Then
        defaultProjectType = ResolveDefaultOption(projectName, projectTypeOptions)
    End If
    If Len(defaultProjectType) = 0 Then defaultProjectType = "Conference"

    proceed = ShowUnifiedSyncDialog( _
        stage, quoteNumber, projectName, companyName, _
        contactName, contactEmail, contactPhone, _
        quoteDateDisplay, leadTime, paymentTerms, _
        subtotal, hasSubtotal, freight, hasFreight, freightDescription, lineItemCount, _
        stateOptions, salesRepOptions, projectTypeOptions, _
        defaultStateOption, defaultSalesRep, defaultProjectType, _
        dealerState, salesRep, projectType _
    )

    If Not proceed Then Exit Sub

    ' ---- Build the sync payload and send it ----
    Dim syncBody As String
    syncBody = BuildSyncBody(quoteNumber, projectName, companyName, salesRep, dealerState, projectType, quoteDateIso, _
                             contactName, contactEmail, contactPhone, _
                             paymentTerms, leadTime, _
                             subtotal, hasSubtotal, freight, hasFreight, _
                             freightDescription, totalAmount, lineItemsJson)

    Dim syncUrl As String, syncStatus As Long, syncResp As String
    syncUrl = API_BASE_URL & "/api/crm/excel/quote/sync"
    syncResp = HttpSend("POST", syncUrl, syncBody, syncStatus)

    If syncStatus >= 200 And syncStatus < 300 Then
        Dim result As Object
        Set result = JsonParse(syncResp)
        Dim toStage As String
        toStage = LCase$(NzStr(JsonGet(result, "toStage")))
        MsgBox "Quote " & quoteNumber & " updated. Stage: " & StageLabel(toStage) & ".", _
               vbInformation, "Arnold Quote Sync"
    Else
        Dim message As String
        message = ResponseMessage(syncResp)
        If Len(message) = 0 Then message = Left$(syncResp, 600)
        MsgBox "Update failed (HTTP " & syncStatus & ")." & vbCrLf & vbCrLf & message, _
               vbCritical, "Arnold Quote Sync"
    End If

    Exit Sub

Fail:
    MsgBox "Unexpected error: " & Err.Number & " - " & Err.Description, _
           vbCritical, "Arnold Quote Sync"
End Sub

'==============================================================================
' Unified confirmation form
'==============================================================================
Private Function ShowUnifiedSyncDialog( _
    ByVal stage As String, _
    ByVal quoteNumber As String, ByVal projectName As String, ByVal companyName As String, _
    ByVal contactName As String, ByVal contactEmail As String, ByVal contactPhone As String, _
    ByVal quoteDateDisplay As String, ByVal leadTime As String, ByVal paymentTerm As String, _
    ByVal subtotal As Double, ByVal hasSubtotal As Boolean, _
    ByVal freight As Double, ByVal hasFreight As Boolean, ByVal freightDesc As String, _
    ByVal lineItemCount As Long, _
    ByVal stateOptions As Collection, ByVal salesRepOptions As Collection, ByVal projectTypeOptions As Collection, _
    ByVal defaultStateOption As String, ByVal defaultSalesRep As String, ByVal defaultProjectType As String, _
    ByRef dealerStateOut As String, ByRef salesRepOut As String, ByRef projectTypeOut As String) As Boolean

    On Error GoTo Fail

    dealerStateOut = ""
    salesRepOut = ""
    projectTypeOut = ""

    mSyncDialogQuoteNumber = quoteNumber
    mSyncDialogProjectName = projectName
    mSyncDialogCompanyName = companyName
    mSyncDialogContactName = contactName
    mSyncDialogContactEmail = contactEmail
    mSyncDialogContactPhone = contactPhone
    mSyncDialogQuoteDateDisplay = quoteDateDisplay
    mSyncDialogLeadTime = leadTime
    mSyncDialogPaymentTerm = paymentTerm
    mSyncDialogSubtotal = subtotal
    mSyncDialogHasSubtotal = hasSubtotal
    mSyncDialogFreight = freight
    mSyncDialogHasFreight = hasFreight
    mSyncDialogFreightDesc = freightDesc
    mSyncDialogLineItemCount = lineItemCount
    mSyncDialogPromptText = BuildTransitionPrompt(stage)

    Set mSyncDialogStateOptions = CloneStringCollection(stateOptions)
    Set mSyncDialogSalesRepOptions = CloneStringCollection(salesRepOptions)
    Set mSyncDialogProjectTypeOptions = CloneStringCollection(projectTypeOptions)

    If Len(defaultStateOption) = 0 And mSyncDialogStateOptions.count > 0 Then
        defaultStateOption = CStr(mSyncDialogStateOptions.Item(1))
    End If
    If Len(defaultSalesRep) = 0 And mSyncDialogSalesRepOptions.count > 0 Then
        defaultSalesRep = CStr(mSyncDialogSalesRepOptions.Item(1))
    End If
    If Len(defaultProjectType) = 0 And mSyncDialogProjectTypeOptions.count > 0 Then
        defaultProjectType = CStr(mSyncDialogProjectTypeOptions.Item(1))
    End If

    mSyncDialogDefaultStateOption = defaultStateOption
    mSyncDialogDefaultSalesRep = defaultSalesRep
    mSyncDialogDefaultProjectType = defaultProjectType

    mSyncDialogSelectedDealerState = ""
    mSyncDialogSelectedSalesRep = ""
    mSyncDialogSelectedProjectType = ""
    mSyncDialogAccepted = False
    mSyncDialogFilterBusy = False

    Dim frm As Object
    Set frm = TryCreateSyncDialogForm()
    If frm Is Nothing Then
        Err.Raise 424, "ShowUnifiedSyncDialog", "Could not load form component '" & SYNC_FORM_COMPONENT_NAME & "'."
    End If
    frm.Show vbModal

    If Not mSyncDialogAccepted Then Exit Function

    dealerStateOut = mSyncDialogSelectedDealerState
    salesRepOut = mSyncDialogSelectedSalesRep
    projectTypeOut = mSyncDialogSelectedProjectType
    ShowUnifiedSyncDialog = True
    Exit Function

Fail:
    MsgBox "Could not open the prebuilt ArnoldSyncQuoteForm." & vbCrLf & vbCrLf & _
           "The macro will continue with the classic prompt flow for this run." & vbCrLf & vbCrLf & _
           "Details: " & Err.Description, vbExclamation, "Arnold Quote Sync"
    ShowUnifiedSyncDialog = ShowUnifiedSyncDialogFallback(stage, dealerStateOut, salesRepOut, projectTypeOut)
End Function

Private Function TryCreateSyncDialogForm() As Object
    Dim formNames As Variant
    formNames = Array( _
        SYNC_FORM_COMPONENT_NAME, _
        "VBAProject." & SYNC_FORM_COMPONENT_NAME, _
        "PERSONAL." & SYNC_FORM_COMPONENT_NAME, _
        "PERSONAL.XLSB." & SYNC_FORM_COMPONENT_NAME _
    )

    Dim i As Long
    For i = LBound(formNames) To UBound(formNames)
        On Error Resume Next
        Set TryCreateSyncDialogForm = UserForms.Add(CStr(formNames(i)))
        If Err.Number = 0 Then
            If Not TryCreateSyncDialogForm Is Nothing Then Exit Function
        End If
        Err.Clear
        Set TryCreateSyncDialogForm = Nothing
        On Error GoTo 0
    Next i
End Function

Private Function BuildTransitionPrompt(ByVal stage As String) As String
    BuildTransitionPrompt = "Move to Proposal Submitted?"
End Function

Private Function ShowUnifiedSyncDialogFallback(ByVal stage As String, _
        ByRef dealerStateOut As String, ByRef salesRepOut As String, ByRef projectTypeOut As String) As Boolean

    Dim selectedStateOption As String
    Dim proceed As Boolean

    dealerStateOut = ""
    salesRepOut = ""
    projectTypeOut = ""

    selectedStateOption = PromptRequiredChoice("Dealer State", mSyncDialogStateOptions, mSyncDialogDefaultStateOption)
    If Len(selectedStateOption) = 0 Then Exit Function

    dealerStateOut = ExtractStateCode(selectedStateOption)
    If Len(dealerStateOut) <> 2 Then
        MsgBox "A valid 2-letter state code is required.", vbExclamation, "Arnold Quote Sync"
        Exit Function
    End If

    salesRepOut = PromptRequiredChoice("Sales Rep", mSyncDialogSalesRepOptions, mSyncDialogDefaultSalesRep)
    If Len(salesRepOut) = 0 Then Exit Function

    projectTypeOut = PromptRequiredChoice("Project Type", mSyncDialogProjectTypeOptions, mSyncDialogDefaultProjectType)
    If Len(projectTypeOut) = 0 Then Exit Function

    Select Case LCase$(Trim$(stage))
        Case "proposal_submission"
            proceed = (MsgBox("Quote " & mSyncDialogQuoteNumber & " is already in Proposal Submitted." & vbCrLf & _
                              "Move to Revision with:" & vbCrLf & _
                              "State: " & dealerStateOut & vbCrLf & _
                              "Sales Rep: " & salesRepOut & vbCrLf & _
                              "Project Type: " & projectTypeOut, _
                              vbQuestion + vbYesNo, "Arnold Quote Sync") = vbYes)
        Case "revision"
            proceed = (MsgBox("Quote " & mSyncDialogQuoteNumber & " is already in Revision." & vbCrLf & _
                              "Update with:" & vbCrLf & _
                              "State: " & dealerStateOut & vbCrLf & _
                              "Sales Rep: " & salesRepOut & vbCrLf & _
                              "Project Type: " & projectTypeOut, _
                              vbQuestion + vbYesNo, "Arnold Quote Sync") = vbYes)
        Case Else
            Dim summary As String
            summary = "Quote Number:   " & mSyncDialogQuoteNumber & vbCrLf & _
                      "Project Name:   " & mSyncDialogProjectName & vbCrLf & _
                      "Company Name:   " & mSyncDialogCompanyName & vbCrLf & _
                      "Contact Name:   " & mSyncDialogContactName & vbCrLf & _
                      "Email:          " & mSyncDialogContactEmail & vbCrLf & _
                      "Contact No.:    " & mSyncDialogContactPhone & vbCrLf & _
                      "State:          " & dealerStateOut & vbCrLf & _
                      "Sales Rep:      " & salesRepOut & vbCrLf & _
                      "Project Type:   " & projectTypeOut & vbCrLf & _
                      "Date:           " & mSyncDialogQuoteDateDisplay & vbCrLf & _
                      "Lead Time:      " & mSyncDialogLeadTime & vbCrLf & _
                      "Payment Term:   " & mSyncDialogPaymentTerm & vbCrLf & _
                      "Sub Net Total:  " & FormatMoney(mSyncDialogSubtotal, mSyncDialogHasSubtotal) & vbCrLf & _
                      "Freight:        " & FormatMoney(mSyncDialogFreight, mSyncDialogHasFreight) & vbCrLf & _
                      "Freight Desc.:  " & IIf(Len(mSyncDialogFreightDesc) > 0, mSyncDialogFreightDesc, "(none)") & vbCrLf & _
                      "Line Items:     " & mSyncDialogLineItemCount & vbCrLf & vbCrLf & _
                      "Move to Proposal Submitted?"
            proceed = (MsgBox(summary, vbQuestion + vbYesNo, "Arnold Quote Sync") = vbYes)
    End Select

    ShowUnifiedSyncDialogFallback = proceed
End Function

Public Sub SyncDialogInitForm(ByVal frm As Object)
    On Error GoTo Fail

    mSyncDialogFilterBusy = True

    SyncDialogSetSummaryLabel frm, "valQuoteNumber", mSyncDialogQuoteNumber
    SyncDialogSetSummaryLabel frm, "valProjectName", mSyncDialogProjectName
    SyncDialogSetSummaryLabel frm, "valCompanyName", mSyncDialogCompanyName
    SyncDialogSetSummaryLabel frm, "valContactName", mSyncDialogContactName
    SyncDialogSetSummaryLabel frm, "valEmail", mSyncDialogContactEmail
    SyncDialogSetSummaryLabel frm, "valContactNo", mSyncDialogContactPhone
    SyncDialogSetSummaryLabel frm, "valDate", mSyncDialogQuoteDateDisplay
    SyncDialogSetSummaryLabel frm, "valLeadTime", mSyncDialogLeadTime
    SyncDialogSetSummaryLabel frm, "valPaymentTerm", mSyncDialogPaymentTerm
    SyncDialogSetSummaryLabel frm, "valSubtotal", FormatMoney(mSyncDialogSubtotal, mSyncDialogHasSubtotal)
    SyncDialogSetSummaryLabel frm, "valFreight", FormatMoney(mSyncDialogFreight, mSyncDialogHasFreight)
    SyncDialogSetSummaryLabel frm, "valFreightDesc", IIf(Len(mSyncDialogFreightDesc) > 0, mSyncDialogFreightDesc, "(none)"))
    SyncDialogSetSummaryLabel frm, "valLineItems", CStr(mSyncDialogLineItemCount)

    frm.Controls("lblTransitionPrompt").Caption = mSyncDialogPromptText

    PopulateComboFromCollection frm.Controls("cboDealerState"), mSyncDialogStateOptions
    PopulateComboFromCollection frm.Controls("cboSalesRep"), mSyncDialogSalesRepOptions
    PopulateComboFromCollection frm.Controls("cboProjectType"), mSyncDialogProjectTypeOptions

    If Len(mSyncDialogDefaultStateOption) > 0 Then
        frm.Controls("cboDealerState").Value = mSyncDialogDefaultStateOption
    End If
    If Len(mSyncDialogDefaultSalesRep) > 0 Then
        frm.Controls("cboSalesRep").Value = mSyncDialogDefaultSalesRep
    End If
    If Len(mSyncDialogDefaultProjectType) > 0 Then
        frm.Controls("cboProjectType").Value = mSyncDialogDefaultProjectType
    End If

    mSyncDialogFilterBusy = False
    SyncDialogRefreshSelectedSummaries frm
    Exit Sub

Fail:
    mSyncDialogFilterBusy = False
    MsgBox "Could not initialize the sync form: " & Err.Description, vbCritical, "Arnold Quote Sync"
End Sub

Public Sub SyncDialogOnDealerStateChange(ByVal frm As Object)
    If mSyncDialogFilterBusy Then
        SyncDialogRefreshSelectedSummaries frm
        Exit Sub
    End If

    SyncDialogApplyStateFilter frm, CStr(frm.Controls("cboDealerState").Text)
End Sub

Public Sub SyncDialogOnSalesRepChange(ByVal frm As Object)
    If mSyncDialogFilterBusy Then Exit Sub
    SyncDialogRefreshSelectedSummaries frm
End Sub

Public Sub SyncDialogOnProjectTypeChange(ByVal frm As Object)
    If mSyncDialogFilterBusy Then Exit Sub
    SyncDialogRefreshSelectedSummaries frm
End Sub

Public Sub SyncDialogHandleYes(ByVal frm As Object)
    Dim dealerStateInput As String
    dealerStateInput = Trim$(CStr(frm.Controls("cboDealerState").Text))

    Dim resolvedStateOption As String
    resolvedStateOption = ResolveStateOptionInput(dealerStateInput, mSyncDialogStateOptions)
    If Len(resolvedStateOption) = 0 Then
        MsgBox "Dealer State is required. Please choose a valid US state.", _
               vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    Dim dealerStateCode As String
    dealerStateCode = ExtractStateCode(resolvedStateOption)
    If Len(dealerStateCode) <> 2 Then
        MsgBox "Dealer State must resolve to a 2-letter state code.", _
               vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    Dim salesRepInput As String
    salesRepInput = Trim$(CStr(frm.Controls("cboSalesRep").Text))

    Dim resolvedSalesRep As String
    resolvedSalesRep = ResolveChoiceInput(salesRepInput, mSyncDialogSalesRepOptions)
    If Len(resolvedSalesRep) = 0 Then
        MsgBox "Sales Rep is required.", vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    Dim projectTypeInput As String
    projectTypeInput = Trim$(CStr(frm.Controls("cboProjectType").Text))

    Dim resolvedProjectType As String
    resolvedProjectType = ResolveChoiceInput(projectTypeInput, mSyncDialogProjectTypeOptions)
    If Len(resolvedProjectType) = 0 Then
        MsgBox "Project Type is required.", vbExclamation, "Arnold Quote Sync"
        Exit Sub
    End If

    mSyncDialogSelectedDealerState = dealerStateCode
    mSyncDialogSelectedSalesRep = resolvedSalesRep
    mSyncDialogSelectedProjectType = resolvedProjectType
    mSyncDialogAccepted = True
    Unload frm
End Sub

Public Sub SyncDialogHandleNo(ByVal frm As Object)
    SyncDialogMarkCancelled
    Unload frm
End Sub

Public Sub SyncDialogMarkCancelled()
    mSyncDialogAccepted = False
End Sub

Private Sub SyncDialogApplyStateFilter(ByVal frm As Object, ByVal filterText As String)
    On Error GoTo CleanFail

    Dim cbo As Object
    Set cbo = frm.Controls("cboDealerState")

    mSyncDialogFilterBusy = True
    cbo.Clear

    Dim i As Long
    Dim optionText As String
    For i = 1 To mSyncDialogStateOptions.count
        optionText = CStr(mSyncDialogStateOptions.Item(i))
        If StateOptionMatchesFilter(optionText, filterText) Then
            cbo.AddItem optionText
        End If
    Next i

    cbo.Text = filterText

    If Len(Trim$(filterText)) > 0 And cbo.ListCount > 0 Then
        On Error Resume Next
        cbo.DropDown
        On Error GoTo CleanFail
    End If

CleanExit:
    mSyncDialogFilterBusy = False
    SyncDialogRefreshSelectedSummaries frm
    Exit Sub

CleanFail:
    Resume CleanExit
End Sub

Private Sub SyncDialogRefreshSelectedSummaries(ByVal frm As Object)
    Dim stateInput As String
    stateInput = Trim$(CStr(frm.Controls("cboDealerState").Text))

    Dim resolvedStateOption As String
    resolvedStateOption = ResolveStateOptionInput(stateInput, mSyncDialogStateOptions)

    Dim stateDisplay As String
    If Len(resolvedStateOption) > 0 Then
        stateDisplay = ExtractStateCode(resolvedStateOption)
    Else
        stateDisplay = ExtractStateCode(stateInput)
    End If
    If Len(stateDisplay) = 0 Then stateDisplay = stateInput

    SyncDialogSetSummaryLabel frm, "valState", stateDisplay
    SyncDialogSetSummaryLabel frm, "valSalesRep", Trim$(CStr(frm.Controls("cboSalesRep").Text))
    SyncDialogSetSummaryLabel frm, "valProjectType", Trim$(CStr(frm.Controls("cboProjectType").Text))
End Sub

Private Sub PopulateComboFromCollection(ByVal cbo As Object, ByVal options As Collection)
    Dim itemValue As Variant
    cbo.Clear
    If options Is Nothing Then Exit Sub

    For Each itemValue In options
        cbo.AddItem CStr(itemValue)
    Next itemValue
End Sub

Private Sub SyncDialogSetSummaryLabel(ByVal frm As Object, ByVal controlName As String, ByVal valueText As String)
    On Error Resume Next
    frm.Controls(controlName).Caption = valueText
    On Error GoTo 0
End Sub

Private Function StateOptionMatchesFilter(ByVal optionText As String, ByVal filterText As String) As Boolean
    Dim needle As String
    needle = LCase$(Trim$(filterText))

    If Len(needle) = 0 Then
        StateOptionMatchesFilter = True
        Exit Function
    End If

    If InStr(1, LCase$(optionText), needle, vbTextCompare) > 0 Then
        StateOptionMatchesFilter = True
        Exit Function
    End If

    If InStr(1, LCase$(ExtractStateCode(optionText)), needle, vbTextCompare) > 0 Then
        StateOptionMatchesFilter = True
        Exit Function
    End If

    StateOptionMatchesFilter = False
End Function

Private Function ResolveStateOptionInput(ByVal rawInput As String, ByVal options As Collection) As String
    Dim trimmedInput As String
    trimmedInput = Trim$(rawInput)
    If Len(trimmedInput) = 0 Then Exit Function

    ResolveStateOptionInput = ResolveChoiceInput(trimmedInput, options)
    If Len(ResolveStateOptionInput) > 0 Then Exit Function

    Dim needle As String
    needle = LCase$(trimmedInput)

    Dim i As Long
    Dim optionText As String
    For i = 1 To options.count
        optionText = CStr(options.Item(i))
        If InStr(1, LCase$(optionText), needle, vbTextCompare) > 0 Then
            ResolveStateOptionInput = optionText
            Exit Function
        End If
    Next i
End Function

Private Function CloneStringCollection(ByVal source As Collection) As Collection
    Dim result As New Collection
    Dim itemValue As Variant

    If source Is Nothing Then
        Set CloneStringCollection = result
        Exit Function
    End If

    For Each itemValue In source
        result.Add CStr(itemValue)
    Next itemValue

    Set CloneStringCollection = result
End Function

Private Function BuildDealerStateOptions() As Collection
    Dim result As New Collection

    result.Add "AL - Alabama"
    result.Add "AK - Alaska"
    result.Add "AZ - Arizona"
    result.Add "AR - Arkansas"
    result.Add "CA - California"
    result.Add "CO - Colorado"
    result.Add "CT - Connecticut"
    result.Add "DE - Delaware"
    result.Add "FL - Florida"
    result.Add "GA - Georgia"
    result.Add "HI - Hawaii"
    result.Add "ID - Idaho"
    result.Add "IL - Illinois"
    result.Add "IN - Indiana"
    result.Add "IA - Iowa"
    result.Add "KS - Kansas"
    result.Add "KY - Kentucky"
    result.Add "LA - Louisiana"
    result.Add "ME - Maine"
    result.Add "MD - Maryland"
    result.Add "MA - Massachusetts"
    result.Add "MI - Michigan"
    result.Add "MN - Minnesota"
    result.Add "MS - Mississippi"
    result.Add "MO - Missouri"
    result.Add "MT - Montana"
    result.Add "NE - Nebraska"
    result.Add "NV - Nevada"
    result.Add "NH - New Hampshire"
    result.Add "NJ - New Jersey"
    result.Add "NM - New Mexico"
    result.Add "NY - New York"
    result.Add "NC - North Carolina"
    result.Add "ND - North Dakota"
    result.Add "OH - Ohio"
    result.Add "OK - Oklahoma"
    result.Add "OR - Oregon"
    result.Add "PA - Pennsylvania"
    result.Add "RI - Rhode Island"
    result.Add "SC - South Carolina"
    result.Add "SD - South Dakota"
    result.Add "TN - Tennessee"
    result.Add "TX - Texas"
    result.Add "UT - Utah"
    result.Add "VT - Vermont"
    result.Add "VA - Virginia"
    result.Add "WA - Washington"
    result.Add "WV - West Virginia"
    result.Add "WI - Wisconsin"
    result.Add "WY - Wyoming"

    Set BuildDealerStateOptions = result
End Function

Private Function BuildSalesRepOptions() As Collection
    Dim result As New Collection
    result.Add "House"
    result.Add "Brad Baldwin"
    result.Add "Eric Arnold"
    result.Add "Heather Huddleston"
    result.Add "John web"
    Set BuildSalesRepOptions = result
End Function

Private Function BuildProjectTypeOptions() As Collection
    Dim result As New Collection
    result.Add "Conference"
    result.Add "Table"
    result.Add "Reception Desk"
    result.Add "Courtroom"
    Set BuildProjectTypeOptions = result
End Function

'==============================================================================
' Extraction helpers
'==============================================================================

' Reads the line item rows and returns a JSON array string. Sets itemCountOut
' to the number of valid items. A row counts as an item only when column A is a
' plain integer AND columns G, H and I contain qty, unit net price and extended
' net price. Numbered rows with a blank quantity, such as optional fee notes or
' the Freight Description heading, are intentionally skipped.
Private Function BuildLineItemsJson(ws As Worksheet, ByRef itemCountOut As Long) As String
    Dim lastRow As Long
    lastRow = LastUsedRow(ws)

    Dim sb As String
    Dim count As Long
    Dim r As Long

    sb = "["
    For r = ROW_LINE_ITEMS_START To lastRow
        If IsPlainInteger(ws.Cells(r, COL_ITEM).Value) Then
            Dim qtyCell As Variant, unitCell As Variant, extCell As Variant
            qtyCell = ws.Cells(r, COL_QTY).Value
            unitCell = ws.Cells(r, COL_UNIT_PRICE).Value
            extCell = ws.Cells(r, COL_EXT_PRICE).Value

            If IsFilledNumber(qtyCell) And IsFilledNumber(unitCell) And IsFilledNumber(extCell) Then
                If count > 0 Then sb = sb & ","
                sb = sb & "{" & _
                    """itemNumber"":" & CStr(CLng(ws.Cells(r, COL_ITEM).Value)) & "," & _
                    """description"":" & JsonStr(CellText(ws, r, COL_DESCRIPTION)) & "," & _
                    """qty"":" & JsonNum(qtyCell) & "," & _
                    """unitPrice"":" & JsonNum(unitCell) & "," & _
                    """extPrice"":" & JsonNum(extCell) & "}"
                count = count + 1
            End If
        End If
    Next r
    sb = sb & "]"

    itemCountOut = count
    BuildLineItemsJson = sb
End Function

' Builds the full JSON object body sent to the sync endpoint.
Private Function BuildSyncBody(quoteNumber As String, projectName As String, _
    companyName As String, salesRep As String, dealerState As String, projectType As String, quoteDateIso As String, _
        contactName As String, contactEmail As String, contactPhone As String, _
        paymentTerms As String, leadTime As String, _
        subtotal As Double, hasSubtotal As Boolean, _
        freight As Double, hasFreight As Boolean, _
        freightDescription As String, totalAmount As Double, _
        lineItemsJson As String) As String

    Dim parts As String
    parts = """quoteNumber"":" & JsonStr(quoteNumber)

    If Len(projectName) > 0 Then parts = parts & ",""title"":" & JsonStr(projectName)
    If Len(companyName) > 0 Then parts = parts & ",""companyName"":" & JsonStr(companyName)
    parts = parts & ",""dealerState"":" & JsonStr(dealerState)
    parts = parts & ",""salesRep"":" & JsonStr(salesRep)
    parts = parts & ",""projectType"":" & JsonStr(projectType)
    If Len(quoteDateIso) > 0 Then parts = parts & ",""opportunityDate"":" & JsonStr(quoteDateIso)
    parts = parts & ",""contactName"":" & JsonStr(contactName)
    parts = parts & ",""contactEmail"":" & JsonStr(contactEmail)
    parts = parts & ",""contactPhone"":" & JsonStr(contactPhone)
    parts = parts & ",""paymentTerms"":" & JsonStr(paymentTerms)
    parts = parts & ",""leadTime"":" & JsonStr(leadTime)

    If hasSubtotal Then
        parts = parts & ",""subtotal"":" & JsonNum(subtotal)
        parts = parts & ",""totalAmount"":" & JsonNum(totalAmount)
    End If
    If hasFreight Then
        parts = parts & ",""freight"":" & JsonNum(freight)
        If Len(freightDescription) > 0 Then parts = parts & ",""freightDescription"":" & JsonStr(freightDescription)
    ElseIf Len(freightDescription) > 0 Then
        parts = parts & ",""freightDescription"":" & JsonStr(freightDescription)
    End If

    parts = parts & ",""lineItems"":" & lineItemsJson

    BuildSyncBody = "{" & parts & "}"
End Function

' Finds the subtotal row where G:H is labeled "Sub Net Total" and I contains
' the amount. A legacy column-A fallback is kept for older quote files.
Private Function FindSubtotal(ws As Worksheet, ByRef found As Boolean) As Double
    Dim lastRow As Long, r As Long
    Dim labelText As String

    found = False
    FindSubtotal = 0
    lastRow = LastUsedRow(ws)

    For r = ROW_LINE_ITEMS_START To lastRow
        labelText = NormalizedCellText(ws, r, COL_TOTAL_LABEL)
        If labelText = "sub net total" Or labelText = "subnet total" Or _
           labelText = "sub total" Or labelText = "subtotal" Then
            If IsFilledNumber(ws.Cells(r, COL_EXT_PRICE).Value) Then
                FindSubtotal = CDbl(ws.Cells(r, COL_EXT_PRICE).Value)
                found = True
                Exit Function
            End If
        End If
    Next r

    FindSubtotal = FindLabeledValue(ws, "sub net total", found)
End Function

' Finds the freight amount and description. The current template has a numbered
' Freight Description heading with no quantity, followed by a row where G:H says
' "Net" and I contains the freight amount. The description on that Net row, such
' as "Dock Delivery : Baltimore, MD", is sent along with the freight amount.
Private Sub FindFreightInfo(ws As Worksheet, ByRef freightOut As Double, _
        ByRef freightDescriptionOut As String, ByRef found As Boolean)

    Dim lastRow As Long, r As Long
    Dim freightSectionRow As Long, startRow As Long
    Dim labelText As String

    freightOut = 0
    freightDescriptionOut = ""
    found = False
    lastRow = LastUsedRow(ws)
    freightSectionRow = 0

    For r = ROW_LINE_ITEMS_START To lastRow
        If IsFreightDescriptionRow(ws, r) Then
            freightSectionRow = r
            Exit For
        End If
    Next r

    If freightSectionRow > 0 Then
        startRow = freightSectionRow + 1
    Else
        startRow = ROW_LINE_ITEMS_START
    End If

    For r = startRow To lastRow
        labelText = NormalizedCellText(ws, r, COL_TOTAL_LABEL)
        If labelText = "net" Then
            If IsFilledNumber(ws.Cells(r, COL_EXT_PRICE).Value) Then
                freightOut = CDbl(ws.Cells(r, COL_EXT_PRICE).Value)
                freightDescriptionOut = CellText(ws, r, COL_DESCRIPTION)
                If Len(freightDescriptionOut) = 0 And freightSectionRow > 0 Then
                    freightDescriptionOut = CellText(ws, freightSectionRow, COL_DESCRIPTION)
                End If
                found = True
                Exit Sub
            End If
        End If
    Next r
End Sub

Private Function IsFreightDescriptionRow(ws As Worksheet, ByVal r As Long) As Boolean
    Dim descriptionText As String
    descriptionText = NormalizedCellText(ws, r, COL_DESCRIPTION)
    IsFreightDescriptionRow = (InStr(1, descriptionText, "freight description", vbTextCompare) > 0)
End Function

Private Function NormalizedCellText(ws As Worksheet, ByVal r As Long, ByVal c As Long) As String
    Dim s As String
    s = CellText(ws, r, c)
    s = Replace(s, ChrW$(160), " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")
    Do While InStr(s, "  ") > 0
        s = Replace(s, "  ", " ")
    Loop
    NormalizedCellText = LCase$(Trim$(s))
End Function

' Scans column A for a row whose trimmed text equals the given label
' (case-insensitive), then returns the right-most numeric value in that row.
' This is retained as a compatibility fallback for older quote templates.
Private Function FindLabeledValue(ws As Worksheet, label As String, ByRef found As Boolean) As Double
    Dim lastRow As Long, r As Long, c As Long
    Dim target As String
    target = LCase$(Trim$(label))
    found = False
    FindLabeledValue = 0

    lastRow = LastUsedRow(ws)

    For r = ROW_LINE_ITEMS_START To lastRow
        If NormalizedCellText(ws, r, COL_ITEM) = target Then
            For c = COL_EXT_PRICE To COL_DESCRIPTION Step -1
                If IsFilledNumber(ws.Cells(r, c).Value) Then
                    FindLabeledValue = CDbl(ws.Cells(r, c).Value)
                    found = True
                    Exit Function
                End If
            Next c
        End If
    Next r
End Function

Private Function LastUsedRow(ws As Worksheet) As Long
    Dim ur As Range
    Set ur = ws.UsedRange
    LastUsedRow = ur.Row + ur.Rows.count - 1
End Function

Private Function CellText(ws As Worksheet, r As Long, c As Long) As String
    Dim v As Variant
    v = ws.Cells(r, c).Value
    If IsError(v) Or IsEmpty(v) Then
        CellText = ""
    Else
        CellText = Trim$(CStr(v))
    End If
End Function

Private Function CellDateIso(ws As Worksheet, r As Long, c As Long) As String
    Dim v As Variant
    v = ws.Cells(r, c).Value
    If IsError(v) Or IsEmpty(v) Then
        CellDateIso = ""
    ElseIf IsDate(v) Then
        CellDateIso = Format$(CDate(v), "yyyy-mm-dd")
    Else
        CellDateIso = Trim$(CStr(v))
    End If
End Function

Private Function IsPlainInteger(ByVal v As Variant) As Boolean
    IsPlainInteger = False
    If IsEmpty(v) Or IsError(v) Then Exit Function
    If Not IsNumeric(v) Then Exit Function
    Dim d As Double
    d = CDbl(v)
    If d < 0 Then Exit Function
    IsPlainInteger = (Int(d) = d)
End Function

Private Function IsFilledNumber(ByVal v As Variant) As Boolean
    IsFilledNumber = False
    If IsEmpty(v) Or IsError(v) Then Exit Function
    If Len(Trim$(CStr(v))) = 0 Then Exit Function
    IsFilledNumber = IsNumeric(v)
End Function

Private Function FormatMoney(ByVal amount As Double, ByVal present As Boolean) As String
    If present Then
        FormatMoney = Format$(amount, "$#,##0.00")
    Else
        FormatMoney = "(none)"
    End If
End Function

Private Function StageLabel(ByVal stage As String) As String
    Select Case stage
        Case "concept": StageLabel = "Concept"
        Case "proposal_submission": StageLabel = "Proposal Submitted"
        Case "revision": StageLabel = "Revision"
        Case "order_placement": StageLabel = "Order Placement"
        Case Else: StageLabel = stage
    End Select
End Function

Private Function ResolveDefaultOption(ByVal preferredValue As String, ByVal options As Collection) As String
    ResolveDefaultOption = ResolveChoiceInput(preferredValue, options)
End Function

Private Function PromptRequiredChoice(ByVal fieldLabel As String, ByVal options As Collection, ByVal defaultValue As String) As String
    Dim prompt As String
    Dim entered As String
    Dim resolved As String

    If options Is Nothing Or options.count = 0 Then
        PromptRequiredChoice = ""
        Exit Function
    End If

    Do
        prompt = "Select " & fieldLabel & " (required)." & vbCrLf & _
                 "Type an option number or exact value." & vbCrLf & vbCrLf & _
                 BuildChoiceList(options)

        entered = InputBox(prompt, "Arnold Quote Sync", defaultValue)

        If Len(Trim$(entered)) = 0 Then
            If MsgBox(fieldLabel & " is required. Cancel this sync?", vbQuestion + vbYesNo, "Arnold Quote Sync") = vbYes Then
                PromptRequiredChoice = ""
                Exit Function
            End If
        Else
            resolved = ResolveChoiceInput(entered, options)
            If Len(resolved) > 0 Then
                PromptRequiredChoice = resolved
                Exit Function
            End If

            MsgBox "Invalid " & fieldLabel & ". Please choose one of the listed options.", _
                   vbExclamation, "Arnold Quote Sync"
        End If
    Loop
End Function

Private Function ResolveChoiceInput(ByVal rawInput As String, ByVal options As Collection) As String
    Dim inputText As String
    inputText = Trim$(rawInput)
    If Len(inputText) = 0 Then Exit Function

    If IsNumeric(inputText) Then
        Dim indexValue As Long
        indexValue = CLng(Val(inputText))
        If indexValue >= 1 And indexValue <= options.count Then
            ResolveChoiceInput = Trim$(CStr(options.Item(indexValue)))
            Exit Function
        End If
    End If

    Dim normalizedInput As String
    normalizedInput = LCase$(inputText)

    Dim i As Long
    For i = 1 To options.count
        Dim optionText As String
        optionText = Trim$(CStr(options.Item(i)))

        If LCase$(optionText) = normalizedInput Then
            ResolveChoiceInput = optionText
            Exit Function
        End If

        If LCase$(ExtractStateCode(optionText)) = normalizedInput Then
            ResolveChoiceInput = optionText
            Exit Function
        End If
    Next i
End Function

Private Function BuildChoiceList(ByVal options As Collection) As String
    Const MAX_LINES As Long = 35
    Dim lines As String
    Dim i As Long
    Dim lineCount As Long

    For i = 1 To options.count
        If lineCount >= MAX_LINES Then Exit For
        lines = lines & Format$(i, "00") & ". " & CStr(options.Item(i)) & vbCrLf
        lineCount = lineCount + 1
    Next i

    If options.count > MAX_LINES Then
        lines = lines & "... and " & CStr(options.count - MAX_LINES) & " more. Type exact value if needed."
    ElseIf Len(lines) > 0 Then
        lines = Left$(lines, Len(lines) - Len(vbCrLf))
    End If

    BuildChoiceList = lines
End Function

Private Function ExtractStateCode(ByVal stateOption As String) As String
    Dim normalized As String
    normalized = UCase$(Trim$(stateOption))

    If Len(normalized) = 2 Then
        ExtractStateCode = normalized
        Exit Function
    End If

    Dim dashPos As Long
    dashPos = InStr(1, normalized, "-")
    If dashPos > 0 Then
        normalized = Trim$(Left$(normalized, dashPos - 1))
    ElseIf InStr(1, normalized, " ") > 0 Then
        normalized = Trim$(Split(normalized, " ")(0))
    End If

    If Len(normalized) = 2 Then
        ExtractStateCode = normalized
    Else
        ExtractStateCode = ""
    End If
End Function

Private Function InferProjectTypeFromProjectName(ByVal projectName As String) As String
    Dim normalized As String
    normalized = LCase$(Trim$(projectName))

    If Len(normalized) = 0 Then
        InferProjectTypeFromProjectName = ""
        Exit Function
    End If

    normalized = Replace(normalized, "-", " ")
    normalized = Replace(normalized, "_", " ")
    Do While InStr(1, normalized, "  ") > 0
        normalized = Replace(normalized, "  ", " ")
    Loop

    If InStr(1, normalized, "reception desk", vbTextCompare) > 0 Or _
       InStr(1, normalized, "reception", vbTextCompare) > 0 Then
        InferProjectTypeFromProjectName = "Reception Desk"
        Exit Function
    End If

    If InStr(1, normalized, "courtroom", vbTextCompare) > 0 Or _
       InStr(1, normalized, "court room", vbTextCompare) > 0 Then
        InferProjectTypeFromProjectName = "Courtroom"
        Exit Function
    End If

    If InStr(1, normalized, "conference table", vbTextCompare) > 0 Or _
       InStr(1, normalized, "conference", vbTextCompare) > 0 Then
        InferProjectTypeFromProjectName = "Conference"
        Exit Function
    End If

    If InStr(1, normalized, "table", vbTextCompare) > 0 Then
        InferProjectTypeFromProjectName = "Table"
        Exit Function
    End If

    InferProjectTypeFromProjectName = ""
End Function

Private Function NormalizeQuoteNumberForSync(ByVal quoteNumber As String) As String
    NormalizeQuoteNumberForSync = Trim$(quoteNumber)
End Function

'==============================================================================
' HTTP - platform specific (WinHttp on Windows, curl on macOS)
'==============================================================================
Private Function HttpSend(method As String, url As String, body As String, ByRef statusOut As Long) As String
#If Mac Then
    Dim tmpDir As String, bodyPath As String, respPath As String, cmd As String, statusStr As String

    tmpDir = Environ$("TMPDIR")
    If Len(tmpDir) = 0 Then tmpDir = "/tmp/"
    If Right$(tmpDir, 1) <> "/" Then tmpDir = tmpDir & "/"
    bodyPath = tmpDir & "arnold_quote_body.json"
    respPath = tmpDir & "arnold_quote_resp.txt"

    cmd = "curl -s -o '" & respPath & "' -w '%{http_code}'"
    cmd = cmd & " -H 'x-excel-sync-token: " & SYNC_TOKEN & "'"
    If Len(body) > 0 Then
        WriteTextFile bodyPath, body
        cmd = cmd & " -X " & method & " -H 'Content-Type: application/json' --data-binary @'" & bodyPath & "'"
    ElseIf method <> "GET" Then
        cmd = cmd & " -X " & method
    End If
    cmd = cmd & " '" & url & "'"

    statusStr = RunShell(cmd)
    statusOut = Val(statusStr)
    HttpSend = ReadTextFile(respPath)
#Else
    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open method, url, False
    http.setRequestHeader "Accept", "application/json"
    http.setRequestHeader "x-excel-sync-token", SYNC_TOKEN
    If Len(body) > 0 Then
        http.setRequestHeader "Content-Type", "application/json"
        http.send body
    Else
        http.send
    End If

    statusOut = http.Status
    HttpSend = http.responseText
#End If
End Function

#If Mac Then
Private Function RunShell(cmd As String) As String
    RunShell = MacScript("do shell script " & Chr$(34) & EscapeForAppleScript(cmd) & Chr$(34))
End Function

Private Function EscapeForAppleScript(ByVal s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, Chr$(34), "\" & Chr$(34))
    EscapeForAppleScript = s
End Function
#End If

Private Sub WriteTextFile(path As String, content As String)
    Dim f As Integer
    f = FreeFile
    Open path For Output As #f
    Print #f, content;
    Close #f
End Sub

Private Function ReadTextFile(path As String) As String
    Dim f As Integer, s As String
    f = FreeFile
    Open path For Input As #f
    If LOF(f) > 0 Then s = Input$(LOF(f), f)
    Close #f
    ReadTextFile = s
End Function

Private Function UrlEncode(ByVal s As String) As String
    Dim i As Long, ch As String, code As Long
    Dim out As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        code = AscW(ch)
        If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) Or _
           (code >= 97 And code <= 122) Or ch = "-" Or ch = "_" Or ch = "." Or ch = "~" Then
            out = out & ch
        ElseIf code > 255 Then
            out = out & ch
        Else
            out = out & "%" & Right$("0" & Hex$(code), 2)
        End If
    Next i
    UrlEncode = out
End Function

'==============================================================================
' JSON output helpers
'==============================================================================
Private Function JsonStr(ByVal s As String) As String
    Dim i As Long, ch As String, code As Long
    Dim out As String
    out = """"
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        code = AscW(ch)
        Select Case ch
            Case """": out = out & "\"""
            Case "\": out = out & "\\"
            Case vbCr: out = out & "\r"
            Case vbLf: out = out & "\n"
            Case vbTab: out = out & "\t"
            Case Else
                If code < 32 Then
                    out = out & "\u" & Right$("000" & Hex$(code), 4)
                Else
                    out = out & ch
                End If
        End Select
    Next i
    JsonStr = out & """"
End Function

Private Function JsonNum(ByVal v As Variant) As String
    ' Always emit a JSON number with a dot decimal separator, locale-independent.
    Dim s As String
    s = CStr(CDbl(v))
    s = Replace(s, ",", ".")
    JsonNum = s
End Function

Private Function NzStr(ByVal v As Variant) As String
    If IsObject(v) Then
        NzStr = ""
    ElseIf IsNull(v) Or IsEmpty(v) Then
        NzStr = ""
    Else
        NzStr = CStr(v)
    End If
End Function

' Pulls a human-readable message out of an error response, if present.
Private Function ResponseMessage(ByVal jsonText As String) As String
    On Error Resume Next
    Dim obj As Object
    Set obj = JsonParse(jsonText)
    ResponseMessage = NzStr(JsonGet(obj, "message"))
    If Len(ResponseMessage) = 0 Then ResponseMessage = NzStr(JsonGet(obj, "error"))
End Function

'==============================================================================
' Minimal JSON parser
'   Objects  -> Collection keyed by field name (Mac + Windows compatible)
'   Arrays   -> Collection (1-based)
'   Strings  -> String
'   Numbers  -> Double
'   Booleans -> Boolean
'   null     -> Null
'==============================================================================
Public Function JsonParse(ByVal text As String) As Object
    mJson = text
    mPos = 1
    mLen = Len(text)
    SkipWs
    Dim v As Variant
    AssignVariant v, ParseValue()
    If IsObject(v) Then
        Set JsonParse = v
    Else
        Set JsonParse = Nothing
    End If
End Function

' Safe accessor for an object key. Returns the value (Variant) or Null.
Public Function JsonGet(ByVal obj As Object, ByVal key As String) As Variant
    JsonGet = Null
    If obj Is Nothing Then Exit Function
    On Error Resume Next
    If IsObject(obj.Item(key)) Then
        Set JsonGet = obj.Item(key)
    Else
        JsonGet = obj.Item(key)
    End If
    On Error GoTo 0
End Function

Private Sub AssignVariant(ByRef target As Variant, ByRef src As Variant)
    If IsObject(src) Then
        Set target = src
    Else
        target = src
    End If
End Sub

Private Function ParseValue() As Variant
    SkipWs
    Dim ch As String
    ch = Mid$(mJson, mPos, 1)
    Select Case ch
        Case "{": Set ParseValue = ParseObject()
        Case "[": Set ParseValue = ParseArray()
        Case """": ParseValue = ParseString()
        Case "t", "f": ParseValue = ParseBool()
        Case "n": ParseValue = ParseNull()
        Case Else: ParseValue = ParseNumber()
    End Select
End Function

Private Function ParseObject() As Object
    ' Use a Collection (works on Mac + Windows) keyed by the JSON field name.
    Dim col As Collection
    Set col = New Collection
    mPos = mPos + 1 ' consume {
    SkipWs
    If Mid$(mJson, mPos, 1) = "}" Then
        mPos = mPos + 1
        Set ParseObject = col
        Exit Function
    End If

    Do
        SkipWs
        Dim k As String
        k = ParseString()
        SkipWs
        mPos = mPos + 1 ' consume :
        Dim v As Variant
        AssignVariant v, ParseValue()
        ' Store under key (skip JSON nulls; an absent key reads back as Null anyway).
        On Error Resume Next
        col.Remove k
        On Error GoTo 0
        If Not IsNull(v) Then col.Add v, k
        SkipWs
        Dim sep As String
        sep = Mid$(mJson, mPos, 1)
        mPos = mPos + 1
        If sep = "}" Then Exit Do
    Loop While mPos <= mLen

    Set ParseObject = col
End Function

Private Function ParseArray() As Object
    Dim col As Collection
    Set col = New Collection
    mPos = mPos + 1 ' consume [
    SkipWs
    If Mid$(mJson, mPos, 1) = "]" Then
        mPos = mPos + 1
        Set ParseArray = col
        Exit Function
    End If

    Do
        Dim v As Variant
        AssignVariant v, ParseValue()
        col.Add v
        SkipWs
        Dim sep As String
        sep = Mid$(mJson, mPos, 1)
        mPos = mPos + 1
        If sep = "]" Then Exit Do
    Loop While mPos <= mLen

    Set ParseArray = col
End Function

Private Function ParseString() As String
    Dim out As String
    mPos = mPos + 1 ' consume opening quote
    Dim ch As String
    Do While mPos <= mLen
        ch = Mid$(mJson, mPos, 1)
        If ch = """" Then
            mPos = mPos + 1
            Exit Do
        ElseIf ch = "\" Then
            mPos = mPos + 1
            Dim esc As String
            esc = Mid$(mJson, mPos, 1)
            Select Case esc
                Case """": out = out & """"
                Case "\": out = out & "\"
                Case "/": out = out & "/"
                Case "b": out = out & Chr$(8)
                Case "f": out = out & Chr$(12)
                Case "n": out = out & vbLf
                Case "r": out = out & vbCr
                Case "t": out = out & vbTab
                Case "u"
                    Dim hex4 As String
                    hex4 = Mid$(mJson, mPos + 1, 4)
                    out = out & ChrW$(CLng("&H" & hex4))
                    mPos = mPos + 4
                Case Else
                    out = out & esc
            End Select
            mPos = mPos + 1
        Else
            out = out & ch
            mPos = mPos + 1
        End If
    Loop
    ParseString = out
End Function

Private Function ParseNumber() As Double
    Dim startPos As Long
    startPos = mPos
    Dim ch As String
    Do While mPos <= mLen
        ch = Mid$(mJson, mPos, 1)
        If InStr("0123456789+-.eE", ch) > 0 Then
            mPos = mPos + 1
        Else
            Exit Do
        End If
    Loop
    Dim raw As String
    raw = Mid$(mJson, startPos, mPos - startPos)
    ParseNumber = CDbl(Replace(raw, ".", DecimalSeparator()))
End Function

Private Function ParseBool() As Boolean
    If Mid$(mJson, mPos, 4) = "true" Then
        mPos = mPos + 4
        ParseBool = True
    Else
        mPos = mPos + 5 ' false
        ParseBool = False
    End If
End Function

Private Function ParseNull() As Variant
    mPos = mPos + 4 ' null
    ParseNull = Null
End Function

Private Sub SkipWs()
    Dim ch As String
    Do While mPos <= mLen
        ch = Mid$(mJson, mPos, 1)
        If ch = " " Or ch = vbTab Or ch = vbCr Or ch = vbLf Then
            mPos = mPos + 1
        Else
            Exit Do
        End If
    Loop
End Sub

' CDbl is locale aware; figure out the local decimal separator so the parser
' can turn JSON's "." numbers into Doubles regardless of regional settings.
Private Function DecimalSeparator() As String
    Static sep As String
    If Len(sep) = 0 Then
        sep = Mid$(CStr(1.5), 2, 1)
    End If
    DecimalSeparator = sep
End Function

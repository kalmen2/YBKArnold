import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Paper, Stack, TextField, Typography } from '@mui/material'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { firebaseStorage } from '../auth/firebase'
import {
  createCrmQuoteLineLibraryEntry,
  fetchCrmQuoteLineLibrary,
  removeCrmQuoteLineLibraryEntry,
  updateCrmQuoteLineLibraryEntry,
  type CrmQuoteLineImage,
  type CrmQuoteLineItem,
  type CrmQuoteLineLibraryEntry,
} from '../features/crm/api'
import { sanitizeStoragePathSegment } from '../lib/fileUtils'
import { QUERY_KEYS } from '../lib/queryKeys'

type LibraryLine = {
  id: string
  parentLineId: string | null
  heading: string
  detailLabel: string
  description: string
  images: CrmQuoteLineImage[]
}

function createLine(parentLineId: string | null = null): LibraryLine {
  return { id: crypto.randomUUID(), parentLineId, heading: '', detailLabel: '', description: '', images: [] }
}

function fromEntry(entry: CrmQuoteLineLibraryEntry | null): LibraryLine[] {
  if (!entry) return [createLine()]
  return entry.lines.map((line) => ({
    id: String(line.id || crypto.randomUUID()),
    parentLineId: line.parentLineId || null,
    heading: line.parentLineId ? '' : String(line.description || '').split('\n')[0],
    detailLabel: String(line.detailLabel || ''),
    description: line.parentLineId
      ? String(line.description || '')
      : String(line.description || '').split('\n').slice(1).join('\n'),
    images: Array.isArray(line.images) ? line.images : [],
  }))
}

function toPayloadLines(lines: LibraryLine[]): CrmQuoteLineItem[] {
  return lines
    .filter((line) => line.heading.trim() || line.detailLabel.trim() || line.description.trim() || line.images.length > 0)
    .map((line, index) => ({
      id: line.id,
      parentLineId: line.parentLineId,
      itemNumber: index + 1,
      detailLabel: line.detailLabel.trim() || null,
      description: (line.parentLineId ? line.description : [line.heading.trim(), line.description.trim()].filter(Boolean).join('\n')) || null,
      qty: null,
      unitPrice: null,
      extPrice: null,
      images: line.parentLineId ? [] : line.images,
    }))
}

function defaultName(lines: LibraryLine[]) {
  return lines.find((line) => !line.parentLineId)?.heading.trim() || ''
}

async function uploadLibraryImage(file: File, entryName: string): Promise<CrmQuoteLineImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Picture must be a JPG, PNG, or WebP image.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Picture must be 10 MB or smaller.')
  const id = crypto.randomUUID()
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '.jpg'
  const path = `crm/quote-line-library/${sanitizeStoragePathSegment(entryName, 'library')}/${id}${extension}`
  const image = new Image()
  const dimensions = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const localUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(localUrl)
      resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null })
    }
    image.onerror = () => {
      URL.revokeObjectURL(localUrl)
      resolve({ width: null, height: null })
    }
    image.src = localUrl
  })
  await uploadBytes(storageRef(firebaseStorage, path), file, { contentType: file.type })
  return { id, url: await getDownloadURL(storageRef(firebaseStorage, path)), name: file.name, width: dimensions.width, height: dimensions.height, displaySize: 'medium' }
}

export default function QuoteLineLibraryPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CrmQuoteLineLibraryEntry | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [lines, setLines] = useState<LibraryLine[]>([createLine()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingLineId, setUploadingLineId] = useState<string | null>(null)

  const libraryQuery = useQuery({ queryKey: QUERY_KEYS.crmQuoteLineLibrary, queryFn: () => fetchCrmQuoteLineLibrary() })
  const entries = useMemo(() => (libraryQuery.data?.entries || []).filter((entry) => entry.name.toLowerCase().includes(search.trim().toLowerCase())), [libraryQuery.data?.entries, search])

  const openEditor = (entry: CrmQuoteLineLibraryEntry | null) => {
    setEditing(entry)
    const nextLines = fromEntry(entry)
    setLines(nextLines)
    setName(entry?.name || defaultName(nextLines))
    setError('')
    setDialogOpen(true)
  }

  const updateLine = (lineId: string, patch: Partial<LibraryLine>) => setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line))
  const addSubline = (parentLineId: string) => setLines((current) => [...current, createLine(parentLineId)])

  const save = async () => {
    const resolvedName = name.trim() || defaultName(lines)
    const payloadLines = toPayloadLines(lines)
    if (!resolvedName || !payloadLines.some((line) => !line.parentLineId)) {
      setError('Enter a library name and a bold top line.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editing) await updateCrmQuoteLineLibraryEntry(editing.id, { name: resolvedName, lines: payloadLines })
      else await createCrmQuoteLineLibraryEntry({ name: resolvedName, lines: payloadLines })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteLineLibrary })
      setDialogOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the library entry.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry: CrmQuoteLineLibraryEntry) => {
    if (!window.confirm(`Send “${entry.name}” to Deleted Items for admin review?`)) return
    try {
      await removeCrmQuoteLineLibraryEntry(entry.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteLineLibrary })
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not delete the library entry.')
    }
  }

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <Box><Typography variant="h6" fontWeight={800}>Quote Line Library</Typography><Typography variant="body2" color="text.secondary">Shared reusable quote headings, details, sublines, and pictures. Prices are never stored here.</Typography></Box>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openEditor(null)}>Add library item</Button>
        </Stack>
      </Paper>
      {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
      <TextField size="small" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search library" InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
      {entries.map((entry) => (
        <Paper key={entry.id} variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
            <Box><Typography fontWeight={800}>{entry.name}</Typography><Typography variant="body2" color="text.secondary">{entry.lines.filter((line) => !line.parentLineId).length} item line{entry.lines.filter((line) => !line.parentLineId).length === 1 ? '' : 's'} · {entry.lines.filter((line) => line.parentLineId).length} subline{entry.lines.filter((line) => line.parentLineId).length === 1 ? '' : 's'}</Typography></Box>
            <Stack direction="row" spacing={0.5}><IconButton aria-label="Edit library item" onClick={() => openEditor(entry)}><EditOutlinedIcon /></IconButton><IconButton color="error" aria-label="Delete library item" onClick={() => void remove(entry)}><DeleteOutlineRoundedIcon /></IconButton></Stack>
          </Stack>
        </Paper>
      ))}
      {!libraryQuery.isLoading && entries.length === 0 ? <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary">No quote library items yet.</Typography></Paper> : null}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editing ? 'Edit Quote Library Item' : 'Add Quote Library Item'}</DialogTitle>
        <DialogContent><Stack spacing={1.25} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField label="Library name" value={name} onChange={(event) => setName(event.target.value)} fullWidth /><Button variant="outlined" disabled={!defaultName(lines)} onClick={() => setName(defaultName(lines))}>Copy top line</Button></Stack>
          {lines.filter((line) => !line.parentLineId).map((line) => {
            const sublines = lines.filter((candidate) => candidate.parentLineId === line.id)
            return <Paper key={line.id} variant="outlined" sx={{ p: 1.25 }}><Stack spacing={0.8}>
              <TextField label="Bold top line" value={line.heading} onChange={(event) => updateLine(line.id, { heading: event.target.value })} />
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8}><TextField label="First column" value={line.detailLabel} onChange={(event) => updateLine(line.id, { detailLabel: event.target.value })} sx={{ flex: 0.6 }} /><TextField label="Second column" value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} multiline minRows={2} sx={{ flex: 1 }} /></Stack>
              {sublines.map((subline) => <Stack key={subline.id} direction={{ xs: 'column', md: 'row' }} spacing={0.5}><TextField label="First column" value={subline.detailLabel} onChange={(event) => updateLine(subline.id, { detailLabel: event.target.value })} sx={{ flex: 0.6 }} /><TextField label="Second column" value={subline.description} onChange={(event) => updateLine(subline.id, { description: event.target.value })} sx={{ flex: 1 }} /><IconButton color="error" onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== subline.id))}><DeleteOutlineRoundedIcon /></IconButton></Stack>)}
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><Button size="small" startIcon={<AddRoundedIcon />} onClick={() => addSubline(line.id)}>Add subline</Button><Button component="label" size="small" startIcon={<FileUploadOutlinedIcon />} disabled={uploadingLineId === line.id}>{uploadingLineId === line.id ? 'Uploading...' : 'Add picture'}<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setUploadingLineId(line.id); try { const image = await uploadLibraryImage(file, name || line.heading || 'library'); updateLine(line.id, { images: [...line.images, image].slice(0, 2) }); } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Could not upload picture.'); } finally { setUploadingLineId(null) } }} /></Button>{line.images.map((image) => <Box key={image.id} sx={{ position: 'relative', width: 56, height: 42 }}><Box component="img" src={image.url} alt={image.name || 'Library'} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} /><IconButton size="small" color="error" sx={{ position: 'absolute', right: -12, top: -12 }} onClick={() => updateLine(line.id, { images: line.images.filter((candidate) => candidate.id !== image.id) })}><DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} /></IconButton></Box>)}</Stack>
            </Stack></Paper>
          })}
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setLines((current) => [...current, createLine()])}>Add another item line</Button>
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save library item'}</Button></DialogActions>
      </Dialog>
    </Stack>
  )
}

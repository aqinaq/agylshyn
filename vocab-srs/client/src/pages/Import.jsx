import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { bulkCreateCards } from '../api.js'

const FIELDS = ['word', 'translation', 'example', 'collocations', 'synonyms', 'antonyms']
const COLUMNS = [
  { key: 'word', label: 'Word' },
  { key: 'translation', label: 'Translation' },
  { key: 'example', label: 'Example' },
  { key: 'collocations', label: 'Collocations' },
  { key: 'synonyms', label: 'Synonyms' },
  { key: 'antonyms', label: 'Antonyms' },
]

const FORMATS = {
  xlsx: { label: 'XLSX', accept: '.xlsx,.xls' },
  tsv: { label: 'TSV', accept: '.tsv,.txt' },
}

const SAMPLE_ROWS = [
  {
    word: 'ubiquitous',
    translation: 'present everywhere',
    example: 'Smartphones are ubiquitous now.',
    collocations: ['ubiquitous presence'],
    synonyms: ['omnipresent'],
    antonyms: ['rare'],
  },
  {
    word: 'meticulous',
    translation: 'very careful and precise',
    example: 'She is meticulous with details.',
    collocations: ['meticulous planning'],
    synonyms: ['thorough'],
    antonyms: ['careless'],
  },
  {
    word: 'ambiguous',
    translation: 'open to more than one interpretation',
    example: 'The instructions were ambiguous.',
    collocations: ['ambiguous statement'],
    synonyms: ['unclear'],
    antonyms: ['clear'],
  },
]

function splitList(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  return String(value)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeRow(raw) {
  const row = {}
  for (const [key, value] of Object.entries(raw)) {
    const k = key.trim().toLowerCase()
    if (FIELDS.includes(k)) row[k] = value
  }
  return {
    word: (row.word || '').toString().trim(),
    translation: (row.translation || '').toString().trim(),
    example: (row.example || '').toString().trim(),
    collocations: splitList(row.collocations),
    synonyms: splitList(row.synonyms),
    antonyms: splitList(row.antonyms),
  }
}

export default function Import() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [format, setFormat] = useState('xlsx')
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function selectFormat(next) {
    setFormat(next)
    setRows([])
    setFileName('')
    setError(null)
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setError(null)

    if (format === 'tsv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter: '\t',
        complete: (results) => setRows(results.data.map(normalizeRow).filter((r) => r.word)),
        error: (err) => setError(err.message),
      })
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          const sheet = wb.Sheets[wb.SheetNames[0]]
          const data = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          setRows(data.map(normalizeRow).filter((r) => r.word))
        } catch (err) {
          setError(err.message)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  function removeRow(i) {
    setRows((rs) => rs.filter((_, idx) => idx !== i))
  }

  async function handleImport() {
    setSubmitting(true)
    setError(null)
    try {
      await bulkCreateCards(rows.filter((r) => r.translation))
      navigate('/cards')
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const hasFile = rows.length > 0
  const previewRows = hasFile ? rows : SAMPLE_ROWS
  const validRows = rows.filter((r) => r.translation)
  const invalidCount = rows.length - validRows.length

  return (
    <div className="page import-page">
      <div className="import-header">
        <button className="icon-btn" onClick={() => navigate('/cards')} aria-label="Close">
          ×
        </button>
        <h1>Import cards</h1>
        <span className="import-header-spacer" />
      </div>

      <div className="segmented">
        {Object.entries(FORMATS).map(([key, f]) => (
          <button
            key={key}
            className={`segmented-btn ${format === key ? 'active' : ''}`}
            onClick={() => selectFormat(key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={`import-preview-wrap ${hasFile ? '' : 'is-sample'}`}>
        <table className="card-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              {hasFile && <th></th>}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((r, i) => (
              <tr key={i} className={hasFile && !r.translation ? 'row-invalid' : ''}>
                <td>{r.word}</td>
                <td>{r.translation || (hasFile && <span className="error">missing</span>)}</td>
                <td>{r.example}</td>
                <td>{r.collocations.join(', ')}</td>
                <td>{r.synonyms.join(', ')}</td>
                <td>{r.antonyms.join(', ')}</td>
                {hasFile && (
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="error">{error}</p>}

      {hasFile && (
        <div className="import-summary">
          <span>{fileName}</span>
          <span>{rows.length} row{rows.length === 1 ? '' : 's'} parsed</span>
          {invalidCount > 0 && (
            <span className="error">{invalidCount} missing a translation</span>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FORMATS[format].accept}
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <div className="import-actions">
        {hasFile && (
          <button
            className="btn btn-primary btn-block"
            disabled={submitting || validRows.length === 0}
            onClick={handleImport}
          >
            {submitting
              ? 'Importing…'
              : `Import ${validRows.length} card${validRows.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button
          className={`btn btn-block ${hasFile ? 'btn-ghost' : 'btn-primary'}`}
          onClick={() => fileInputRef.current.click()}
        >
          {hasFile ? 'Choose a different file' : 'Select a file'}
        </button>
      </div>
    </div>
  )
}

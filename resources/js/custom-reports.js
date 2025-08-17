// Custom Report Builder - Simplified Implementation
console.log('custom-reports.js loading...')

class CustomReportBuilder {
  constructor() {
    this.currentReportId = null
    this.selectedAccountId = null
    this.selectedAccountData = null
    this.widgetCounter = 0
    this.widgetHistory = []
    this.charts = new Map()

    console.log('CustomReportBuilder instantiated')
  }

  init() {
    console.log('CustomReportBuilder init() called')

    // Elements
    this.reportCanvas = document.getElementById('reportCanvas')
    this.widgetContainer = document.getElementById('widgetContainer')
    this.emptyState = document.getElementById('emptyState')

    if (!this.reportCanvas) {
      console.log('Not on custom reports page')
      return
    }

    console.log('Setting up custom report builder...')

    // Setup all functionality
    this.setupAccountSelection()
    this.setupDragAndDrop()
    this.setupButtons()

    console.log('Custom report builder ready')
  }

  setupAccountSelection() {
    console.log('Setting up account selection...')
    const accountOptions = document.querySelectorAll('.account-option')
    console.log(`Found ${accountOptions.length} account options`)

    accountOptions.forEach((option) => {
      option.addEventListener('click', (e) => {
        e.preventDefault()
        console.log('Account clicked:', option.dataset.accountId)

        // Clear all selections
        accountOptions.forEach((opt) => {
          opt.classList.remove('border-green-600', 'bg-green-50')
          opt.classList.add('border-gray-200')
        })

        // Select this one
        option.classList.remove('border-gray-200')
        option.classList.add('border-green-600', 'bg-green-50')

        // Store data
        this.selectedAccountId = option.dataset.accountId
        this.selectedAccountData = {
          id: option.dataset.accountId,
          name: option.dataset.accountName,
          platform: option.dataset.platform,
        }

        console.log('Account selected:', this.selectedAccountData)

        // Hide error
        const error = document.getElementById('accountRequiredError')
        if (error) error.classList.add('hidden')

        this.notify(`Selected: ${this.selectedAccountData.name}`, 'success')
      })
    })
  }

  setupDragAndDrop() {
    console.log('Setting up drag and drop...')

    // Setup draggable widgets
    document.querySelectorAll('.widget-source').forEach((source) => {
      source.addEventListener('dragstart', (e) => {
        console.log('Drag start:', source.dataset.widgetType)
        const data = {
          type: source.dataset.widgetType,
          config: JSON.parse(source.dataset.widgetConfig || '{}'),
        }
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', JSON.stringify(data))
        source.style.opacity = '0.5'
      })

      source.addEventListener('dragend', () => {
        source.style.opacity = '1'
      })
    })

    // Setup drop zone
    this.reportCanvas.addEventListener('dragover', (e) => {
      e.preventDefault()
      this.reportCanvas.classList.add('border-green-400', 'bg-green-50')
    })

    this.reportCanvas.addEventListener('dragleave', (e) => {
      if (e.target === this.reportCanvas) {
        this.reportCanvas.classList.remove('border-green-400', 'bg-green-50')
      }
    })

    this.reportCanvas.addEventListener('drop', (e) => {
      e.preventDefault()
      console.log('Drop event')
      this.reportCanvas.classList.remove('border-green-400', 'bg-green-50')

      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'))
        console.log('Dropped widget:', data)
        this.addWidget(data)
      } catch (err) {
        console.error('Drop error:', err)
      }
    })
  }

  setupButtons() {
    console.log('Setting up buttons...')

    // Save button
    const saveBtn = document.getElementById('saveReportBtn')
    if (saveBtn) {
      saveBtn.onclick = () => {
        console.log('Save clicked')
        this.handleSave()
      }
    }

    // Preview button
    const previewBtn = document.getElementById('previewReportBtn')
    if (previewBtn) {
      previewBtn.onclick = () => {
        console.log('Preview clicked')
        this.handlePreview()
      }
    }

    // Clear button
    const clearBtn = document.getElementById('clearCanvasBtn')
    if (clearBtn) {
      clearBtn.onclick = () => this.clearCanvas()
    }

    // Undo button
    const undoBtn = document.getElementById('undoBtn')
    if (undoBtn) {
      undoBtn.onclick = () => this.notify('Undo coming soon', 'info')
    }

    // Modal buttons
    const cancelBtn = document.getElementById('cancelSaveBtn')
    if (cancelBtn) {
      cancelBtn.onclick = () => this.hideModal()
    }

    const saveForm = document.getElementById('saveReportForm')
    if (saveForm) {
      saveForm.onsubmit = (e) => {
        e.preventDefault()
        this.saveReport(e)
      }
    }
  }

  addWidget(data) {
    console.log('Adding widget:', data)

    this.widgetCounter++
    const id = `widget-${this.widgetCounter}`

    // Create widget HTML
    let html = ''
    const config = data.config

    if (data.type === 'metric') {
      const values = {
        spend: '$2,450.50',
        impressions: '145,680',
        clicks: '4,720',
        conversions: '142',
        ctr: '3.24%',
        cpc: '$0.52',
      }
      const colors = {
        green: 'bg-green-500',
        blue: 'bg-blue-500',
        purple: 'bg-purple-500',
        orange: 'bg-orange-500',
        indigo: 'bg-indigo-500',
        yellow: 'bg-yellow-500',
      }
      html = `
        <div id="${id}" class="widget-item bg-white border rounded-lg p-4 relative group" data-widget-type="metric" data-widget-config='${JSON.stringify(config)}'>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100">×</button>
          <div class="flex items-center">
            <div class="flex-1">
              <h4 class="text-sm text-gray-500 uppercase">${config.title}</h4>
              <p class="text-2xl font-bold">${values[config.type]}</p>
            </div>
            <div class="w-12 h-12 ${colors[config.color]} rounded flex items-center justify-center">
              <i class="fas ${config.icon} text-white"></i>
            </div>
          </div>
        </div>
      `
    } else if (data.type === 'chart') {
      html = `
        <div id="${id}" class="widget-item bg-white border rounded-lg p-4 relative group" data-widget-type="chart" data-widget-config='${JSON.stringify(config)}'>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100">×</button>
          <h3 class="text-lg font-semibold mb-4">${config.title}</h3>
          <canvas id="${id}-chart" style="max-height: 300px;"></canvas>
        </div>
      `
    } else if (data.type === 'table') {
      const account = this.selectedAccountData?.name || 'Account'
      html = `
        <div id="${id}" class="widget-item bg-white border rounded-lg overflow-hidden relative group" data-widget-type="table" data-widget-config='${JSON.stringify(config)}'>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100 z-10">×</button>
          <div class="px-4 py-3 border-b">
            <h3 class="text-lg font-semibold">${config.title}</h3>
          </div>
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs uppercase">Name</th>
                <th class="px-4 py-2 text-left text-xs uppercase">Account</th>
                <th class="px-4 py-2 text-left text-xs uppercase">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="px-4 py-2">Sample 1</td><td class="px-4 py-2">${account}</td><td class="px-4 py-2">$1,250</td></tr>
              <tr><td class="px-4 py-2">Sample 2</td><td class="px-4 py-2">${account}</td><td class="px-4 py-2">$890</td></tr>
            </tbody>
          </table>
        </div>
      `
    } else if (data.type === 'text') {
      let content = ''
      if (config.type === 'heading') {
        content = '<h2 class="text-2xl font-bold">Report Heading</h2>'
      } else if (config.type === 'description') {
        content = '<p class="text-gray-700">Description text</p>'
      } else {
        content = '<hr class="border-gray-300 my-4">'
      }
      html = `
        <div id="${id}" class="widget-item bg-white border rounded-lg p-4 relative group" data-widget-type="text" data-widget-config='${JSON.stringify(config)}'>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100">×</button>
          ${content}
        </div>
      `
    }

    // Add to container
    if (this.widgetContainer && html) {
      this.emptyState.style.display = 'none'
      this.widgetContainer.classList.remove('hidden')
      this.widgetContainer.insertAdjacentHTML('beforeend', html)

      // Init chart if needed
      if (data.type === 'chart') {
        setTimeout(() => this.initChart(id, config), 100)
      }

      // Hide error
      const error = document.getElementById('canvasRequiredError')
      if (error) error.classList.add('hidden')

      this.notify('Widget added!', 'success')
    }
  }

  initChart(id, config) {
    console.log('Init chart:', id)
    const canvas = document.getElementById(`${id}-chart`)
    if (!canvas || typeof Chart === 'undefined') return

    let data = {}
    if (config.type === 'line') {
      data = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [
          {
            label: 'Spend',
            data: [1200, 1350, 1100, 1800, 1650, 2100],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
          },
        ],
      }
    } else if (config.type === 'bar') {
      data = {
        labels: ['Google', 'Meta', 'LinkedIn'],
        datasets: [
          {
            label: 'Spend',
            data: [1500, 800, 150],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6'],
          },
        ],
      }
    } else if (config.type === 'pie' || config.type === 'doughnut') {
      data = {
        labels: ['Google', 'Meta', 'LinkedIn'],
        datasets: [
          {
            data: [60, 32, 8],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6'],
          },
        ],
      }
    }

    try {
      const chart = new Chart(canvas, {
        type: config.type,
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
        },
      })
      this.charts.set(id, chart)
    } catch (err) {
      console.error('Chart error:', err)
    }
  }

  removeWidget(id) {
    console.log('Remove widget:', id)
    const el = document.getElementById(id)
    if (el) {
      if (this.charts.has(id)) {
        this.charts.get(id).destroy()
        this.charts.delete(id)
      }
      el.remove()

      if (this.widgetContainer.children.length === 0) {
        this.widgetContainer.classList.add('hidden')
        this.emptyState.style.display = 'block'
      }
    }
  }

  clearCanvas() {
    if (!confirm('Clear all widgets?')) return

    this.charts.forEach((chart) => chart.destroy())
    this.charts.clear()

    this.widgetContainer.innerHTML = ''
    this.widgetContainer.classList.add('hidden')
    this.emptyState.style.display = 'block'

    this.notify('Canvas cleared', 'info')
  }

  getWidgets() {
    const widgets = []
    const elements = this.widgetContainer?.querySelectorAll('.widget-item') || []
    elements.forEach((el, i) => {
      widgets.push({
        id: el.id,
        type: el.dataset.widgetType,
        config: JSON.parse(el.dataset.widgetConfig || '{}'),
        order: i,
      })
    })
    return widgets
  }

  validate() {
    let valid = true
    const errors = []

    if (!this.selectedAccountId) {
      const error = document.getElementById('accountRequiredError')
      if (error) error.classList.remove('hidden')
      errors.push('Select an account')
      valid = false
    }

    if (this.getWidgets().length === 0) {
      const error = document.getElementById('canvasRequiredError')
      if (error) error.classList.remove('hidden')
      errors.push('Add at least one widget')
      valid = false
    }

    if (!valid) {
      this.notify(errors.join(' and '), 'warning')
    }

    return valid
  }

  handleSave() {
    console.log('Handle save')
    if (!this.validate()) return

    const modal = document.getElementById('saveReportModal')
    if (modal) modal.classList.remove('hidden')
  }

  handlePreview() {
    console.log('Handle preview')
    if (!this.validate()) return

    const widgets = this.getWidgets()
    let html = ''

    widgets.forEach((w) => {
      if (w.type === 'metric') {
        html += `<div class="bg-white p-4 rounded border"><h4>${w.config.title}</h4><p class="text-2xl font-bold">Sample Value</p></div>`
      } else if (w.type === 'chart') {
        html += `<div class="bg-white p-4 rounded border"><h3>${w.config.title}</h3><p>Chart placeholder</p></div>`
      } else if (w.type === 'table') {
        html += `<div class="bg-white p-4 rounded border"><h3>${w.config.title}</h3><p>Table placeholder</p></div>`
      } else if (w.type === 'text') {
        html += `<div class="bg-white p-4 rounded border"><p>Text content</p></div>`
      }
    })

    const preview = window.open('', '_blank', 'width=1200,height=800')
    preview.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Preview</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 p-8">
        <h1 class="text-3xl font-bold mb-8">Report Preview</h1>
        <div class="space-y-4">${html}</div>
      </body>
      </html>
    `)
    preview.document.close()
  }

  hideModal() {
    const modal = document.getElementById('saveReportModal')
    if (modal) modal.classList.add('hidden')
  }

  async saveReport(e) {
    const form = new FormData(e.target)
    const data = {
      name: form.get('name'),
      description: form.get('description'),
      connectedAccountId: parseInt(this.selectedAccountId),
      widgetLayout: this.getWidgets(),
      platform: this.selectedAccountData?.platform,
      ajax: true,
    }

    console.log('Saving:', data)

    try {
      // Get CSRF token
      const token = document.querySelector('meta[name="csrf-token"]')?.content || ''

      const res = await fetch('/reports/save-layout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': token,
        },
        body: JSON.stringify(data),
      })

      const result = await res.json()
      console.log('Save result:', result)

      if (result.success) {
        this.hideModal()
        this.notify('Report saved!', 'success')
        setTimeout(() => {
          window.location.href = '/reports'
        }, 2000)
      } else {
        this.notify('Error: ' + (result.error || 'Unknown'), 'error')
      }
    } catch (err) {
      console.error('Save error:', err)
      this.notify('Failed to save', 'error')
    }
  }

  notify(msg, type = 'info') {
    console.log(`[${type}] ${msg}`)

    // Remove old notifications
    document.querySelectorAll('.notify-toast').forEach((n) => n.remove())

    const colors = {
      success: 'bg-green-100 text-green-700',
      error: 'bg-red-100 text-red-700',
      warning: 'bg-yellow-100 text-yellow-700',
      info: 'bg-blue-100 text-blue-700',
    }

    const div = document.createElement('div')
    div.className = `notify-toast fixed top-4 right-4 px-4 py-2 rounded ${colors[type]} z-50`
    div.textContent = msg
    document.body.appendChild(div)

    setTimeout(() => div.remove(), 5000)
  }
}

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, creating CustomReportBuilder')
    window.customReportBuilder = new CustomReportBuilder()
    window.customReportBuilder.init()
  })
} else {
  console.log('DOM already loaded, creating CustomReportBuilder')
  window.customReportBuilder = new CustomReportBuilder()
  window.customReportBuilder.init()
}

console.log('custom-reports.js loaded')

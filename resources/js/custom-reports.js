/**
 * Custom Report Builder Module
 * Handles all JavaScript functionality for the drag and drop report builder
 */

class CustomReportBuilder {
  constructor() {
    this.currentReportId = null;
    this.selectedAccountId = null;
    this.selectedAccountData = null;
    this.widgetCounter = 0;
    this.widgetHistory = [];
    this.reportCanvas = null;
    this.widgetContainer = null;
    this.emptyState = null;
    this.sortableCanvas = null;
    this.charts = new Map(); // Store chart instances
    
    this.init();
  }

  init() {
    // Only initialize if we're on the custom reports page
    if (!document.getElementById('reportCanvas')) {
      return;
    }
    
    this.setupElements();
    this.setupAccountSelection();
    this.initializeDragAndDrop();
    this.setupEventListeners();
    this.loadExistingReport();
  }

  setupElements() {
    this.reportCanvas = document.getElementById('reportCanvas');
    this.widgetContainer = document.getElementById('widgetContainer');
    this.emptyState = document.getElementById('emptyState');
  }

  setupAccountSelection() {
    const accountOptions = document.querySelectorAll('.account-option');
    
    accountOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        // Remove selection from all other options
        accountOptions.forEach(opt => {
          opt.classList.remove('border-purple-500', 'bg-purple-50');
          const icon = opt.querySelector('.account-selected-icon');
          if (icon) icon.classList.add('hidden');
        });
        
        // Select this option
        option.classList.add('border-purple-500', 'bg-purple-50');
        const selectedIcon = option.querySelector('.account-selected-icon');
        if (selectedIcon) selectedIcon.classList.remove('hidden');
        
        // Store selected account data
        this.selectedAccountId = option.dataset.accountId;
        this.selectedAccountData = {
          id: option.dataset.accountId,
          name: option.dataset.accountName,
          platform: option.dataset.platform
        };
        
        // Hide error message if showing
        const errorElement = document.getElementById('accountRequiredError');
        if (errorElement) {
          errorElement.classList.add('hidden');
        }
        
        this.showNotification(`Selected account: ${this.selectedAccountData.name}`, 'success');
      });
    });
  }

  initializeDragAndDrop() {
    // Setup native HTML5 drag and drop for widget sources
    const widgetSources = document.querySelectorAll('.widget-source');
    
    widgetSources.forEach(source => {
      source.addEventListener('dragstart', (e) => {
        const widgetData = {
          type: source.dataset.widgetType,
          config: JSON.parse(source.dataset.widgetConfig)
        };
        e.dataTransfer.setData('application/json', JSON.stringify(widgetData));
        e.dataTransfer.effectAllowed = 'copy';
        source.style.opacity = '0.5';
      });
      
      source.addEventListener('dragend', (e) => {
        source.style.opacity = '1';
      });
    });

    // Setup drop zone on canvas
    this.reportCanvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.reportCanvas.classList.add('border-purple-400', 'bg-purple-25');
    });

    this.reportCanvas.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.reportCanvas.classList.remove('border-purple-400', 'bg-purple-25');
    });

    this.reportCanvas.addEventListener('drop', (e) => {
      e.preventDefault();
      this.reportCanvas.classList.remove('border-purple-400', 'bg-purple-25');
      
      try {
        const widgetData = JSON.parse(e.dataTransfer.getData('application/json'));
        this.handleWidgetAdd(widgetData);
      } catch (error) {
        console.error('Error handling drop:', error);
        this.showNotification('Error adding widget. Please try again.', 'error');
      }
    });

    // Initialize sortable for the widget container to allow reordering
    if (this.widgetContainer) {
      this.sortableCanvas = new Sortable(this.widgetContainer, {
        animation: 150,
        chosenClass: 'opacity-50',
        ghostClass: 'opacity-25',
        handle: '.widget-item',
        onUpdate: (evt) => {
          this.saveToHistory();
        }
      });
    }
  }

  handleWidgetAdd(widgetData) {
    // Generate unique widget ID
    this.widgetCounter++;
    const widgetId = `widget-${this.widgetCounter}`;
    
    // Create the actual widget element
    const widgetElement = this.createWidget(widgetId, widgetData.type, widgetData.config);
    
    // Add to container
    if (this.widgetContainer) {
      this.widgetContainer.insertAdjacentHTML('beforeend', widgetElement);
    }
    
    // Show widget container and hide empty state
    this.showWidgetContainer();
    
    // Initialize any charts in the new widget
    setTimeout(() => {
      this.initializeWidgetCharts(widgetId, widgetData.type, widgetData.config);
    }, 100);
    
    // Save to history
    this.saveToHistory();
    
    // Hide canvas error if showing
    const canvasError = document.getElementById('canvasRequiredError');
    if (canvasError) {
      canvasError.classList.add('hidden');
    }
  }

  createWidget(id, type, config) {
    switch(type) {
      case 'metric':
        return this.createMetricWidget(id, config);
      case 'chart':
        return this.createChartWidget(id, config);
      case 'table':
        return this.createTableWidget(id, config);
      case 'text':
        return this.createTextWidget(id, config);
      default:
        return '';
    }
  }

  createMetricWidget(id, config) {
    const sampleValue = this.getSampleMetricValue(config.type);
    const colorClass = this.getColorClass(config.color);
    
    return `
      <div id="${id}" class="widget-item bg-white border border-gray-200 rounded-lg p-4 relative group cursor-move" data-widget-type="metric" data-widget-config='${JSON.stringify(config)}'>
        <div class="widget-controls absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="window.customReportBuilder.editWidget('${id}')" class="p-1 text-gray-400 hover:text-blue-600 mr-1">
            <i class="fas fa-edit text-xs"></i>
          </button>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="p-1 text-gray-400 hover:text-red-600">
            <i class="fas fa-times text-xs"></i>
          </button>
        </div>
        <div class="flex items-center">
          <div class="flex-1">
            <h4 class="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">${config.title}</h4>
            <p class="text-2xl font-bold text-gray-900">${sampleValue}</p>
            <p class="text-xs text-gray-500 mt-1">Last 30 days</p>
          </div>
          <div class="w-12 h-12 ${colorClass} rounded-lg flex items-center justify-center">
            <i class="fas ${config.icon} text-white"></i>
          </div>
        </div>
      </div>
    `;
  }

  createChartWidget(id, config) {
    return `
      <div id="${id}" class="widget-item bg-white border border-gray-200 rounded-lg p-4 relative group cursor-move" data-widget-type="chart" data-widget-config='${JSON.stringify(config)}'>
        <div class="widget-controls absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button onclick="window.customReportBuilder.editWidget('${id}')" class="p-1 text-gray-400 hover:text-blue-600 mr-1">
            <i class="fas fa-edit text-xs"></i>
          </button>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="p-1 text-gray-400 hover:text-red-600">
            <i class="fas fa-times text-xs"></i>
          </button>
        </div>
        <h3 class="text-lg font-semibold text-gray-900 mb-4">${config.title}</h3>
        <div class="relative h-64">
          <canvas id="${id}-chart"></canvas>
        </div>
      </div>
    `;
  }

  createTableWidget(id, config) {
    return `
      <div id="${id}" class="widget-item bg-white border border-gray-200 rounded-lg overflow-hidden relative group cursor-move" data-widget-type="table" data-widget-config='${JSON.stringify(config)}'>
        <div class="widget-controls absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button onclick="window.customReportBuilder.editWidget('${id}')" class="p-1 text-gray-400 hover:text-blue-600 mr-1">
            <i class="fas fa-edit text-xs"></i>
          </button>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="p-1 text-gray-400 hover:text-red-600">
            <i class="fas fa-times text-xs"></i>
          </button>
        </div>
        <div class="px-4 py-3 border-b border-gray-200">
          <h3 class="text-lg font-semibold text-gray-900">${config.title}</h3>
        </div>
        <div class="overflow-x-auto">
          ${this.getSampleTableData(config.type)}
        </div>
      </div>
    `;
  }

  createTextWidget(id, config) {
    let content = '';
    switch(config.type) {
      case 'heading':
        content = '<h2 class="text-2xl font-bold text-gray-900">Report Heading</h2>';
        break;
      case 'description':
        content = '<p class="text-gray-700">This is a description text widget. You can customize the content to provide context for your report sections.</p>';
        break;
      case 'divider':
        content = '<hr class="border-gray-300 my-4">';
        break;
    }
    
    return `
      <div id="${id}" class="widget-item bg-white border border-gray-200 rounded-lg p-4 relative group cursor-move" data-widget-type="text" data-widget-config='${JSON.stringify(config)}'>
        <div class="widget-controls absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="window.customReportBuilder.editWidget('${id}')" class="p-1 text-gray-400 hover:text-blue-600 mr-1">
            <i class="fas fa-edit text-xs"></i>
          </button>
          <button onclick="window.customReportBuilder.removeWidget('${id}')" class="p-1 text-gray-400 hover:text-red-600">
            <i class="fas fa-times text-xs"></i>
          </button>
        </div>
        ${content}
      </div>
    `;
  }

  initializeWidgetCharts(widgetId, widgetType, config) {
    if (widgetType !== 'chart') return;
    
    const ctx = document.getElementById(`${widgetId}-chart`);
    if (!ctx) return;
    
    try {
      const chartConfig = {
        type: config.type,
        data: this.getSampleChartData(config.type),
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: config.type === 'pie' || config.type === 'doughnut' ? 'bottom' : 'top'
            }
          }
        }
      };
      
      const chart = new Chart(ctx, chartConfig);
      this.charts.set(widgetId, chart);
    } catch (error) {
      console.warn('Chart initialization failed:', error);
    }
  }

  setupEventListeners() {
    // Save report button
    const saveBtn = document.getElementById('saveReportBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.showSaveModal());
    }
    
    // Preview report button
    const previewBtn = document.getElementById('previewReportBtn');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => this.previewReport());
    }
    
    // Clear canvas button
    const clearBtn = document.getElementById('clearCanvasBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearCanvas());
    }
    
    // Undo button
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undoLastAction());
    }
    
    // Modal controls
    const cancelSaveBtn = document.getElementById('cancelSaveBtn');
    if (cancelSaveBtn) {
      cancelSaveBtn.addEventListener('click', () => this.hideSaveModal());
    }
    
    const saveForm = document.getElementById('saveReportForm');
    if (saveForm) {
      saveForm.addEventListener('submit', (e) => this.saveReport(e));
    }
    
    // Close modals when clicking outside
    window.addEventListener('click', (event) => {
      const saveModal = document.getElementById('saveReportModal');
      
      if (event.target === saveModal) {
        this.hideSaveModal();
      }
    });
  }

  // Validation Functions
  validateRequiredFields() {
    let isValid = true;
    const errors = [];

    // Check account selection
    if (!this.selectedAccountId) {
      const accountError = document.getElementById('accountRequiredError');
      if (accountError) {
        accountError.classList.remove('hidden');
      }
      errors.push('Please select an account');
      isValid = false;
    }

    // Check if at least one widget exists
    const currentLayout = this.getCurrentLayout();
    if (currentLayout.length === 0) {
      const canvasError = document.getElementById('canvasRequiredError');
      if (canvasError) {
        canvasError.classList.remove('hidden');
      }
      errors.push('Please add at least one widget to the canvas');
      isValid = false;
    }

    if (!isValid) {
      this.showNotification(errors.join(' and ') + '.', 'warning');
    }

    return isValid;
  }

  // Helper Functions
  getSampleMetricValue(type) {
    const values = {
      spend: '$2,450.50',
      impressions: '145,680',
      clicks: '4,720',
      conversions: '142',
      ctr: '3.24%',
      cpc: '$0.52',
      cpa: '$17.26'
    };
    return values[type] || '$0';
  }

  getColorClass(color) {
    const colorClasses = {
      green: 'bg-green-500',
      blue: 'bg-blue-500',
      purple: 'bg-purple-500',
      orange: 'bg-orange-500',
      indigo: 'bg-indigo-500',
      yellow: 'bg-yellow-500',
      red: 'bg-red-500',
      gray: 'bg-gray-500'
    };
    return colorClasses[color] || 'bg-gray-500';
  }

  getSampleTableData(type) {
    switch(type) {
      case 'campaign':
        return `
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Spend</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clicks</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CTR</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr><td class="px-4 py-3 text-sm font-medium">Brand Campaign</td><td class="px-4 py-3 text-sm">$1,250</td><td class="px-4 py-3 text-sm">2,100</td><td class="px-4 py-3 text-sm">3.2%</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">Product Campaign</td><td class="px-4 py-3 text-sm">$890</td><td class="px-4 py-3 text-sm">1,580</td><td class="px-4 py-3 text-sm">2.8%</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">Retargeting</td><td class="px-4 py-3 text-sm">$310</td><td class="px-4 py-3 text-sm">1,040</td><td class="px-4 py-3 text-sm">4.1%</td></tr>
            </tbody>
          </table>
        `;
      case 'platform':
        return `
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Platform</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Spend</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Impressions</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clicks</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr><td class="px-4 py-3 text-sm font-medium">Google Ads</td><td class="px-4 py-3 text-sm">$1,500</td><td class="px-4 py-3 text-sm">85,000</td><td class="px-4 py-3 text-sm">2,800</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">Meta Ads</td><td class="px-4 py-3 text-sm">$800</td><td class="px-4 py-3 text-sm">45,000</td><td class="px-4 py-3 text-sm">1,620</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">LinkedIn</td><td class="px-4 py-3 text-sm">$150</td><td class="px-4 py-3 text-sm">15,680</td><td class="px-4 py-3 text-sm">300</td></tr>
            </tbody>
          </table>
        `;
      case 'keywords':
        return `
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keyword</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Impressions</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clicks</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CPC</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr><td class="px-4 py-3 text-sm font-medium">digital marketing</td><td class="px-4 py-3 text-sm">15,240</td><td class="px-4 py-3 text-sm">582</td><td class="px-4 py-3 text-sm">$0.85</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">online advertising</td><td class="px-4 py-3 text-sm">12,180</td><td class="px-4 py-3 text-sm">420</td><td class="px-4 py-3 text-sm">$1.12</td></tr>
              <tr><td class="px-4 py-3 text-sm font-medium">ppc management</td><td class="px-4 py-3 text-sm">8,920</td><td class="px-4 py-3 text-sm">310</td><td class="px-4 py-3 text-sm">$1.45</td></tr>
            </tbody>
          </table>
        `;
      default:
        return '<p class="p-4 text-gray-500">Sample table data</p>';
    }
  }

  getSampleChartData(type) {
    switch(type) {
      case 'line':
        return {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Spend ($)',
            data: [1200, 1350, 1100, 1800, 1650, 2100],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true
          }]
        };
      case 'bar':
        return {
          labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
          datasets: [{
            label: 'Spend ($)',
            data: [1500, 800, 150],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
          }]
        };
      case 'pie':
      case 'doughnut':
        return {
          labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
          datasets: [{
            data: [60, 32, 8],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
          }]
        };
      default:
        return { labels: [], datasets: [] };
    }
  }

  showWidgetContainer() {
    if (this.emptyState) {
      this.emptyState.style.display = 'none';
    }
    if (this.widgetContainer) {
      this.widgetContainer.classList.remove('hidden');
    }
  }

  hideWidgetContainer() {
    if (this.widgetContainer && this.widgetContainer.children.length === 0) {
      if (this.emptyState) {
        this.emptyState.style.display = 'block';
      }
      this.widgetContainer.classList.add('hidden');
    }
  }

  saveToHistory() {
    const currentLayout = this.getCurrentLayout();
    this.widgetHistory.push(JSON.parse(JSON.stringify(currentLayout)));
    
    // Keep only last 10 states
    if (this.widgetHistory.length > 10) {
      this.widgetHistory.shift();
    }
  }

  getCurrentLayout() {
    const widgets = [];
    if (!this.widgetContainer) return widgets;
    
    const widgetElements = this.widgetContainer.querySelectorAll('.widget-item');
    
    widgetElements.forEach((element, index) => {
      widgets.push({
        id: element.id,
        type: element.dataset.widgetType,
        config: JSON.parse(element.dataset.widgetConfig),
        order: index
      });
    });
    
    return widgets;
  }

  loadLayout(layout) {
    if (!this.widgetContainer) return;
    
    // Destroy existing charts
    this.charts.forEach(chart => chart.destroy());
    this.charts.clear();
    
    this.widgetContainer.innerHTML = '';
    
    if (!layout || layout.length === 0) {
      this.hideWidgetContainer();
      return;
    }
    
    layout.forEach(widget => {
      const widgetElement = this.createWidget(widget.id, widget.type, widget.config);
      this.widgetContainer.innerHTML += widgetElement;
    });
    
    this.showWidgetContainer();
    
    // Initialize charts
    setTimeout(() => {
      layout.forEach(widget => {
        if (widget.type === 'chart') {
          this.initializeWidgetCharts(widget.id, widget.type, widget.config);
        }
      });
    }, 100);
  }

  // Public methods for widget management
  removeWidget(widgetId) {
    const element = document.getElementById(widgetId);
    if (element) {
      // Destroy chart if it exists
      if (this.charts.has(widgetId)) {
        this.charts.get(widgetId).destroy();
        this.charts.delete(widgetId);
      }
      
      element.remove();
      this.hideWidgetContainer();
      this.saveToHistory();
    }
  }

  editWidget(widgetId) {
    // For now, just show an alert - could be expanded to show edit modal
    this.showNotification('Widget editing feature coming soon!', 'info');
  }

  clearCanvas() {
    if (confirm('Are you sure you want to clear all widgets?')) {
      // Destroy all charts
      this.charts.forEach(chart => chart.destroy());
      this.charts.clear();
      
      if (this.widgetContainer) {
        this.widgetContainer.innerHTML = '';
      }
      this.hideWidgetContainer();
      this.widgetHistory = [];
      this.widgetCounter = 0;
      this.currentReportId = null;
    }
  }

  undoLastAction() {
    if (this.widgetHistory.length > 1) {
      this.widgetHistory.pop(); // Remove current state
      const previousState = this.widgetHistory[this.widgetHistory.length - 1];
      this.loadLayout(previousState);
    } else if (this.widgetHistory.length === 1) {
      this.clearCanvas();
    }
  }

  // Modal Functions
  showSaveModal() {
    if (!this.validateRequiredFields()) {
      return;
    }
    
    const modal = document.getElementById('saveReportModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  hideSaveModal() {
    const modal = document.getElementById('saveReportModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    const form = document.getElementById('saveReportForm');
    if (form) {
      form.reset();
    }
  }

  async saveReport(event) {
    event.preventDefault();
    
    if (!this.validateRequiredFields()) {
      return;
    }
    
    const formData = new FormData(event.target);
    const currentLayout = this.getCurrentLayout();
    
    const reportData = {
      name: formData.get('name'),
      description: formData.get('description'),
      connectedAccountId: parseInt(this.selectedAccountId),
      widgetLayout: currentLayout,
      platform: this.selectedAccountData.platform,
      ajax: true
    };
    
    if (this.currentReportId) {
      reportData.reportId = this.currentReportId;
    }
    
    try {
      const response = await fetch('/reports/save-layout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        },
        body: JSON.stringify(reportData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.currentReportId = result.report.id;
        this.hideSaveModal();
        this.showNotification('Report saved successfully!', 'success');
      } else {
        this.showNotification('Error saving report: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error saving report:', error);
      this.showNotification('Error saving report. Please try again.', 'error');
    }
  }

  async previewReport() {
    if (!this.validateRequiredFields()) {
      return;
    }
    
    const currentLayout = this.getCurrentLayout();
    
    try {
      const response = await fetch('/reports/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        },
        body: JSON.stringify({
          widgetLayout: currentLayout,
          reportId: this.currentReportId,
          connectedAccountId: parseInt(this.selectedAccountId)
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.openPreviewWindow(result.layout, result.sampleData);
      } else {
        this.showNotification('Error generating preview: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error generating preview:', error);
      this.showNotification('Error generating preview. Please try again.', 'error');
    }
  }

  openPreviewWindow(layout, sampleData) {
    const previewWindow = window.open('', '_blank', 'width=1200,height=800');
    const previewHtml = this.generatePreviewHtml(layout, sampleData);
    previewWindow.document.write(previewHtml);
    previewWindow.document.close();
  }

  generatePreviewHtml(layout, sampleData) {
    let widgetsHtml = '';
    
    layout.forEach(widget => {
      const cleanWidget = this.createWidget(widget.id, widget.type, widget.config)
        .replace(/class="widget-controls[^"]*"/g, 'style="display: none;"')
        .replace(/<button[^>]*>.*?<\/button>/gs, '')
        .replace(/cursor-move/g, '')
        .replace(/group/g, '');
      
      widgetsHtml += cleanWidget;
    });
    
    const accountInfo = this.selectedAccountData ? 
      `<p class="text-gray-600">Account: ${this.selectedAccountData.name} (${this.selectedAccountData.platform.replace('_', ' ')})</p>` : '';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Custom Report Preview</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js"></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      </head>
      <body class="bg-gray-50 p-8">
        <div class="max-w-7xl mx-auto">
          <div class="mb-8 text-center">
            <h1 class="text-3xl font-bold text-gray-900 mb-2">Custom Marketing Report</h1>
            <p class="text-gray-600">Generated on ${new Date().toLocaleDateString()}</p>
            ${accountInfo}
          </div>
          <div class="space-y-6">
            ${widgetsHtml}
          </div>
        </div>
        <script>
          // Initialize charts in preview
          setTimeout(() => {
            ${this.getPreviewChartScript()}
          }, 100);
        </script>
      </body>
      </html>
    `;
  }

  getPreviewChartScript() {
    return `
      const chartElements = document.querySelectorAll('canvas[id$="-chart"]');
      chartElements.forEach(canvas => {
        const widgetId = canvas.id.replace('-chart', '');
        const widget = document.getElementById(widgetId);
        if (widget) {
          const config = JSON.parse(widget.dataset.widgetConfig);
          initializePreviewChart(canvas, config);
        }
      });
      
      function initializePreviewChart(canvas, config) {
        try {
          const chartConfig = {
            type: config.type,
            data: getSampleChartData(config.type),
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: config.type === 'pie' || config.type === 'doughnut' ? 'bottom' : 'top'
                }
              }
            }
          };
          new Chart(canvas, chartConfig);
        } catch (error) {
          console.warn('Chart initialization failed:', error);
        }
      }
      
      function getSampleChartData(type) {
        switch(type) {
          case 'line':
            return {
              labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
              datasets: [{
                label: 'Spend ($)',
                data: [1200, 1350, 1100, 1800, 1650, 2100],
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
              }]
            };
          case 'bar':
            return {
              labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
              datasets: [{
                label: 'Spend ($)',
                data: [1500, 800, 150],
                backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
              }]
            };
          case 'pie':
          case 'doughnut':
            return {
              labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
              datasets: [{
                data: [60, 32, 8],
                backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
              }]
            };
          default:
            return { labels: [], datasets: [] };
        }
      }
    `;
  }

  loadExistingReport() {
    // Check if there's a report ID in the URL to load
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('report');
    
    if (reportId) {
      this.currentReportId = reportId;
      this.loadReportLayout(reportId);
    }
  }

  async loadReportLayout(reportId) {
    try {
      const response = await fetch(`/reports/${reportId}/load-layout`, {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      const result = await response.json();
      
      if (result.success && result.layout) {
        this.loadLayout(result.layout);
        this.showNotification('Report loaded successfully!', 'success');
      }
    } catch (error) {
      console.error('Error loading report:', error);
      this.showNotification('Error loading report.', 'error');
    }
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-6 py-4 rounded-lg shadow-lg z-50 max-w-md transition-opacity duration-300 ${
      type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 
      type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' : 
      type === 'warning' ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' :
      'bg-blue-50 border border-blue-200 text-blue-800'
    }`;
    notification.innerHTML = `
      <div class="flex items-center">
        <i class="fas ${
          type === 'success' ? 'fa-check-circle' : 
          type === 'error' ? 'fa-exclamation-circle' : 
          type === 'warning' ? 'fa-exclamation-triangle' :
          'fa-info-circle'
        } mr-3 ${
          type === 'success' ? 'text-green-600' : 
          type === 'error' ? 'text-red-600' : 
          type === 'warning' ? 'text-yellow-600' :
          'text-blue-600'
        }" aria-hidden="true"></i>
        <span class="font-medium">${message}</span>
      </div>
    `;
    
    // Add to DOM
    document.body.appendChild(notification);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      notification.style.transition = "opacity 0.5s ease-out";
      notification.style.opacity = "0";
      setTimeout(() => notification.remove(), 500);
    }, 5000);
  }
}

// Initialize the custom report builder when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.customReportBuilder = new CustomReportBuilder();
});

export default CustomReportBuilder;
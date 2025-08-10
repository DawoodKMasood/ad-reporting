# Ad Reporting Tool - Folder Structure

## Application Structure

```
app/
├── controllers/
│   ├── auth/
│   ├── dashboard/
│   ├── integrations/
│   ├── reports/
│   └── users/
├── middleware/
│   ├── auth_middleware.ts (existing)
│   ├── guest_middleware.ts (existing)
│   ├── integration_middleware.ts
│   └── api_rate_limit_middleware.ts
├── models/
│   ├── user.ts (existing)
│   ├── integration.ts
│   ├── campaign.ts
│   ├── ad_account.ts
│   └── metric.ts
├── services/
│   ├── integrations/
│   │   ├── google_ads_service.ts
│   │   ├── meta_ads_service.ts
│   │   └── tiktok_ads_service.ts
│   ├── data/
│   │   ├── data_transformer_service.ts
│   │   └── metrics_calculator_service.ts
│   └── reports/
│       ├── report_generator_service.ts
│       └── chart_data_service.ts
├── jobs/
│   ├── sync_ad_data_job.ts
│   ├── refresh_tokens_job.ts
│   └── generate_reports_job.ts
├── validators/
│   ├── auth/
│   ├── integration/
│   └── reports/
├── types/
│   ├── ad_platforms.ts
│   ├── metrics.ts
│   └── api_responses.ts
└── exceptions/
    ├── handler.ts (existing)
    ├── integration_error.ts
    └── api_rate_limit_error.ts
```

## Database Structure

```
database/
├── migrations/
│   ├── create_users_table.ts
│   ├── create_integrations_table.ts
│   ├── create_ad_accounts_table.ts
│   ├── create_campaigns_table.ts
│   ├── create_metrics_table.ts
│   └── create_refresh_tokens_table.ts
├── seeders/
│   └── user_seeder.ts
└── factories/
    ├── user_factory.ts
    └── integration_factory.ts
```

## Frontend Resources

```
resources/
├── views/
│   ├── layouts/
│   │   ├── app.edge
│   │   └── auth.edge
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── login.edge
│   │   │   ├── register.edge
│   │   │   └── forgot_password.edge
│   │   ├── dashboard/
│   │   │   ├── index.edge
│   │   │   └── overview.edge
│   │   ├── integrations/
│   │   │   ├── index.edge
│   │   │   ├── connect.edge
│   │   │   └── manage.edge
│   │   ├── reports/
│   │   │   ├── index.edge
│   │   │   └── create.edge
│   │   └── errors/ (existing)
│   └── components/
│       ├── charts/
│       ├── forms/
│       ├── navigation/
│       └── widgets/
├── js/
│   ├── components/
│   │   ├── charts/
│   │   ├── dashboard/
│   │   └── integrations/
│   ├── services/
│   │   ├── api_client.js
│   │   ├── chart_service.js
│   │   └── data_service.js
│   ├── utils/
│   │   ├── date_helpers.js
│   │   ├── formatters.js
│   │   └── validators.js
│   └── app.js (existing)
└── css/
    ├── components/
    │   ├── dashboard.css
    │   ├── charts.css
    │   └── forms.css
    ├── layouts/
    │   ├── auth.css
    │   └── app.css
    └── app.css (existing)
```

## Configuration

```
config/
├── auth.ts (existing)
├── database.ts (existing)
├── cors.ts
├── integrations.ts
├── queue.ts
└── cache.ts
```

## API Routes Structure

```
start/
├── routes/
│   ├── auth.ts
│   ├── dashboard.ts
│   ├── integrations.ts
│   ├── reports.ts
│   └── api.ts
├── routes.ts (existing - main routes file)
├── kernel.ts (existing)
└── env.ts (existing)
```

## Additional Directories

```
storage/
├── logs/
├── tmp/
└── uploads/

tests/
├── functional/
│   ├── auth/
│   ├── dashboard/
│   └── integrations/
├── unit/
│   ├── services/
│   └── models/
└── browser/

docs/
├── api/
├── setup/
└── integrations/
```

## Key Organizational Principles

### Controllers
- Separate controllers by feature domain
- Thin controllers, business logic in services
- Consistent API response formats

### Services
- Platform-specific integration services
- Data transformation and processing services
- Reusable business logic components

### Models
- Database entity representations
- Relationship definitions
- Data validation rules

### Jobs
- Background data synchronization
- Scheduled report generation
- Token refresh automation

### Frontend
- Component-based organization
- Separation of concerns (services, utilities, components)
- Responsive and modular CSS structure

### Configuration
- Environment-specific settings
- API credentials and endpoints
- Feature flags and toggles
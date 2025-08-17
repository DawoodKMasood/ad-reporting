import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const GoogleAdsController = () => import('#controllers/google_ads_controller')

// Google Ads API routes
router
  .group(() => {
    router
      .get('/:accountId/campaigns', [GoogleAdsController, 'campaigns'])
      .as('google_ads.campaigns')
    router
      .get('/:accountId/ad-groups', [GoogleAdsController, 'adGroups'])
      .as('google_ads.ad_groups')
    router.get('/:accountId/keywords', [GoogleAdsController, 'keywords']).as('google_ads.keywords')
    router.get('/:accountId/ads', [GoogleAdsController, 'ads']).as('google_ads.ads')
    router
      .get('/:accountId/search-terms', [GoogleAdsController, 'searchTerms'])
      .as('google_ads.search_terms')
    router
      .get('/:accountId/audiences', [GoogleAdsController, 'audiences'])
      .as('google_ads.audiences')
    router
      .get('/:accountId/account-hierarchy', [GoogleAdsController, 'accountHierarchy'])
      .as('google_ads.account_hierarchy')
    router
      .get('/:accountId/bidding-strategies', [GoogleAdsController, 'biddingStrategies'])
      .as('google_ads.bidding_strategies')
    router
      .get('/:accountId/extensions', [GoogleAdsController, 'extensions'])
      .as('google_ads.extensions')
    router
      .get('/:accountId/conversion-actions', [GoogleAdsController, 'conversionActions'])
      .as('google_ads.conversion_actions')
    router
      .get('/:accountId/enriched-data', [GoogleAdsController, 'enrichedData'])
      .as('google_ads.enriched_data')

    // Write operations
    router
      .post('/:accountId/campaigns', [GoogleAdsController, 'createCampaign'])
      .as('google_ads.create_campaign')
    router
      .post('/:accountId/ad-groups', [GoogleAdsController, 'createAdGroup'])
      .as('google_ads.create_ad_group')
    router
      .post('/:accountId/keywords', [GoogleAdsController, 'addKeywords'])
      .as('google_ads.add_keywords')
    router.post('/:accountId/ads', [GoogleAdsController, 'createAd']).as('google_ads.create_ad')
    router
      .patch('/:accountId/campaigns/status', [GoogleAdsController, 'updateCampaignStatus'])
      .as('google_ads.update_campaign_status')
  })
  .prefix('/api/google-ads')
  .middleware([middleware.auth()])

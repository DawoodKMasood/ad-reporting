import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import googleAdsService from '#services/google_ads_service'
import googleAdsEnhancedService from '#services/google_ads_enhanced_service'
import logger from '@adonisjs/core/services/logger'

export default class GoogleAdsController {
  async campaigns({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const campaigns = await googleAdsEnhancedService.getCampaigns(connectedAccount.id, user.id)
      
      return { success: true, data: campaigns }
    } catch (error) {
      logger.error('Error fetching campaigns:', error)
      return response.badRequest({ error: 'Failed to fetch campaigns', message: error.message })
    }
  }

  async adGroups({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { campaignId } = request.qs()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const adGroups = await googleAdsEnhancedService.getAdGroups(connectedAccount.id, user.id, campaignId)
      
      return { success: true, data: adGroups }
    } catch (error) {
      logger.error('Error fetching ad groups:', error)
      return response.badRequest({ error: 'Failed to fetch ad groups', message: error.message })
    }
  }

  async keywords({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { adGroupId } = request.qs()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const keywords = await googleAdsEnhancedService.getKeywords(connectedAccount.id, user.id, adGroupId)
      
      return { success: true, data: keywords }
    } catch (error) {
      logger.error('Error fetching keywords:', error)
      return response.badRequest({ error: 'Failed to fetch keywords', message: error.message })
    }
  }

  async ads({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { adGroupId } = request.qs()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const ads = await googleAdsEnhancedService.getAds(connectedAccount.id, user.id, adGroupId)
      
      return { success: true, data: ads }
    } catch (error) {
      logger.error('Error fetching ads:', error)
      return response.badRequest({ error: 'Failed to fetch ads', message: error.message })
    }
  }

  async searchTerms({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const searchTerms = await googleAdsEnhancedService.getSearchTerms(connectedAccount.id, user.id)
      
      return { success: true, data: searchTerms }
    } catch (error) {
      logger.error('Error fetching search terms:', error)
      return response.badRequest({ error: 'Failed to fetch search terms', message: error.message })
    }
  }

  async audiences({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const [ageRanges, genders, locations] = await Promise.all([
        googleAdsEnhancedService.getAudienceInsights(connectedAccount.id, user.id),
        googleAdsEnhancedService.getGenderInsights(connectedAccount.id, user.id),
        googleAdsEnhancedService.getLocationInsights(connectedAccount.id, user.id)
      ])
      
      return { 
        success: true, 
        data: { 
          ageRanges, 
          genders, 
          locations 
        } 
      }
    } catch (error) {
      logger.error('Error fetching audience insights:', error)
      return response.badRequest({ error: 'Failed to fetch audience insights', message: error.message })
    }
  }

  async createCampaign({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { name, budgetMicros, advertisingChannelType, biddingStrategy } = request.body()

      const result = await googleAdsEnhancedService.createCampaign(connectedAccount.id, user.id, {
        name,
        budgetMicros,
        advertisingChannelType,
        biddingStrategy
      })
      
      return { success: true, data: result }
    } catch (error) {
      logger.error('Error creating campaign:', error)
      return response.badRequest({ error: 'Failed to create campaign', message: error.message })
    }
  }

  async createAdGroup({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { campaignId, name, cpcBidMicros } = request.body()

      const result = await googleAdsEnhancedService.createAdGroup(connectedAccount.id, user.id, campaignId, {
        name,
        cpcBidMicros
      })
      
      return { success: true, data: result }
    } catch (error) {
      logger.error('Error creating ad group:', error)
      return response.badRequest({ error: 'Failed to create ad group', message: error.message })
    }
  }

  async addKeywords({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { adGroupId, keywords } = request.body()

      const result = await googleAdsEnhancedService.addKeywords(connectedAccount.id, user.id, adGroupId, keywords)
      
      return { success: true, data: result }
    } catch (error) {
      logger.error('Error adding keywords:', error)
      return response.badRequest({ error: 'Failed to add keywords', message: error.message })
    }
  }

  async createAd({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { adGroupId, headline1, headline2, description, finalUrls } = request.body()

      const result = await googleAdsEnhancedService.createTextAd(connectedAccount.id, user.id, adGroupId, {
        headline1,
        headline2,
        description,
        finalUrls
      })
      
      return { success: true, data: result }
    } catch (error) {
      logger.error('Error creating ad:', error)
      return response.badRequest({ error: 'Failed to create ad', message: error.message })
    }
  }

  async updateCampaignStatus({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { campaignId, status } = request.body()

      const result = await googleAdsEnhancedService.updateCampaignStatus(connectedAccount.id, user.id, campaignId, status)
      
      return { success: true, data: result }
    } catch (error) {
      logger.error('Error updating campaign status:', error)
      return response.badRequest({ error: 'Failed to update campaign status', message: error.message })
    }
  }

  async accountHierarchy({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const hierarchy = await googleAdsEnhancedService.getAccountHierarchy(connectedAccount.id, user.id)
      
      return { success: true, data: hierarchy }
    } catch (error) {
      logger.error('Error fetching account hierarchy:', error)
      return response.badRequest({ error: 'Failed to fetch account hierarchy', message: error.message })
    }
  }

  async biddingStrategies({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const strategies = await googleAdsEnhancedService.getBiddingStrategies(connectedAccount.id, user.id)
      
      return { success: true, data: strategies }
    } catch (error) {
      logger.error('Error fetching bidding strategies:', error)
      return response.badRequest({ error: 'Failed to fetch bidding strategies', message: error.message })
    }
  }

  async extensions({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const extensions = await googleAdsEnhancedService.getExtensions(connectedAccount.id, user.id)
      
      return { success: true, data: extensions }
    } catch (error) {
      logger.error('Error fetching extensions:', error)
      return response.badRequest({ error: 'Failed to fetch extensions', message: error.message })
    }
  }

  async conversionActions({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const conversions = await googleAdsEnhancedService.getConversionActions(connectedAccount.id, user.id)
      
      return { success: true, data: conversions }
    } catch (error) {
      logger.error('Error fetching conversion actions:', error)
      return response.badRequest({ error: 'Failed to fetch conversion actions', message: error.message })
    }
  }

  async enrichedData({ params, auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const { dateRange } = request.qs()
      
      const enrichedData = await googleAdsService.getEnrichedCampaignData(
        connectedAccount.id, 
        user.id,
        dateRange ? JSON.parse(dateRange) : undefined
      )
      
      return { success: true, data: enrichedData }
    } catch (error) {
      logger.error('Error fetching enriched data:', error)
      return response.badRequest({ error: 'Failed to fetch enriched data', message: error.message })
    }
  }
}

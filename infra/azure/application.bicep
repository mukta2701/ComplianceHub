targetScope = 'resourceGroup'

param location string = resourceGroup().location
param managedEnvironmentName string = 'cae-compliancehub-staging-uks'
param containerAppName string = 'ca-compliancehub-staging'
param imageReference string
param revisionSuffix string

param nextPublicSupabaseUrl string
param nextPublicSupabaseAnonKey string
param nextPublicSupabasePublishableKey string = ''
param nextPublicSiteUrl string
param mcpResourceUrl string
param supabaseOauthIssuer string
param supabaseOauthJwksUrl string
param mcpJwtAlgorithms string = 'RS256,ES256'
@allowed([
  'bridge'
  'strict'
])
param dailyDigestReservationMode string = 'strict'
param complianceHubReleaseSha string = 'unknown'

param supabaseRefName string
param encryptionRefName string
param cronRefName string
param slackAllowedWebhookSha256RefName string
param githubAppIdRefName string
param githubAppClientIdRefName string
param githubAppClientCredentialRefName string
param githubAppPrivateKeyRefName string
param githubWebhookHmacRefName string
param githubAppSlugRefName string
param githubAllowedAccountIdRefName string
param githubApprovedSecurityWorkflowIdsRefName string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: managedEnvironmentName
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 5
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 3100
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'compliancehub'
          image: imageReference
          env: [
            { name: 'NEXT_PUBLIC_SUPABASE_URL', value: nextPublicSupabaseUrl }
            { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: nextPublicSupabaseAnonKey }
            { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', value: nextPublicSupabasePublishableKey }
            { name: 'NEXT_PUBLIC_SITE_URL', value: nextPublicSiteUrl }
            { name: 'MCP_RESOURCE_URL', value: mcpResourceUrl }
            { name: 'SUPABASE_OAUTH_ISSUER', value: supabaseOauthIssuer }
            { name: 'SUPABASE_OAUTH_JWKS_URL', value: supabaseOauthJwksUrl }
            { name: 'MCP_JWT_ALGORITHMS', value: mcpJwtAlgorithms }
            { name: 'DAILY_DIGEST_RESERVATION_MODE', value: dailyDigestReservationMode }
            { name: 'COMPLIANCEHUB_RELEASE_SHA', value: complianceHubReleaseSha }
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: supabaseRefName }
            { name: 'APP_ENCRYPTION_KEY', secretRef: encryptionRefName }
            { name: 'CRON_SECRET', secretRef: cronRefName }
            { name: 'SLACK_ALLOWED_WEBHOOK_SHA256', secretRef: slackAllowedWebhookSha256RefName }
            { name: 'GITHUB_APP_ID', secretRef: githubAppIdRefName }
            { name: 'GITHUB_APP_CLIENT_ID', secretRef: githubAppClientIdRefName }
            { name: 'GITHUB_APP_CLIENT_SECRET', secretRef: githubAppClientCredentialRefName }
            { name: 'GITHUB_APP_PRIVATE_KEY', secretRef: githubAppPrivateKeyRefName }
            { name: 'GITHUB_WEBHOOK_SECRET', secretRef: githubWebhookHmacRefName }
            { name: 'GITHUB_APP_SLUG', secretRef: githubAppSlugRefName }
            { name: 'GITHUB_ALLOWED_ACCOUNT_ID', secretRef: githubAllowedAccountIdRefName }
            { name: 'GITHUB_APPROVED_SECURITY_WORKFLOW_IDS', secretRef: githubApprovedSecurityWorkflowIdsRefName }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health/live', port: 3100 }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 2
              failureThreshold: 30
              successThreshold: 1
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health/live', port: 3100 }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3100 }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 6
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output containerAppFqdn string = app.properties.configuration.ingress.fqdn

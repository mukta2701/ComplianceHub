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

@secure()
param supabaseServiceRoleKey string

@secure()
param appEncryptionKey string

@secure()
param cronSecret string

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
        targetPort: 3000
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        {
          name: 'supabase-service-role-key'
          value: supabaseServiceRoleKey
        }
        {
          name: 'app-encryption-key'
          value: appEncryptionKey
        }
        {
          name: 'cron-secret'
          value: cronSecret
        }
      ]
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
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-service-role-key' }
            { name: 'APP_ENCRYPTION_KEY', secretRef: 'app-encryption-key' }
            { name: 'CRON_SECRET', secretRef: 'cron-secret' }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health/live', port: 3000 }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 2
              failureThreshold: 30
              successThreshold: 1
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health/live', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
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

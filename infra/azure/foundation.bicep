targetScope = 'subscription'

@description('Azure region for the staging workload.')
param location string = 'uksouth'
param resourceGroupName string = 'rg-compliancehub-staging-uks'
param managedEnvironmentName string = 'cae-compliancehub-staging-uks'
param containerAppName string = 'ca-compliancehub-staging'

@description('Receives Azure budget threshold notifications.')
param budgetContactEmail string

@description('Budgets use the subscription billing currency.')
param monthlyBudgetAmount int = 1

@description('Budget start time must be the first day of a month.')
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module workload './foundation.resources.bicep' = {
  name: 'compliancehub-staging-foundation'
  scope: resourceGroup
  params: {
    location: location
    managedEnvironmentName: managedEnvironmentName
    containerAppName: containerAppName
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'compliancehub-staging-monthly'
  properties: {
    amount: monthlyBudgetAmount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [resourceGroupName]
      }
    }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
    }
  }
}

output resourceGroupName string = resourceGroup.name
output managedEnvironmentName string = workload.outputs.managedEnvironmentName
output containerAppName string = workload.outputs.containerAppName
output containerAppFqdn string = workload.outputs.containerAppFqdn

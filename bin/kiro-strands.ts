#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KiroStrandsStack } from '../lib/kiro-strands-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';

new KiroStrandsStack(app, `KiroStrandsStack-${environment}`, {
  environment: environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
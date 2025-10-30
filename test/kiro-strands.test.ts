import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as KiroStrands from '../lib/kiro-strands-stack';

test('Strands Agent Lambda Function Created', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that Lambda function is created with correct properties
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'python3.12',
    Handler: 'agent_handler.handler',
    FunctionName: 'code-analysis-strands-agent-dev',
    Architectures: ['arm64'],
    MemorySize: 1024,
    Timeout: 60,
  });
});

test('API Gateway Created', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that REST API is created
  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'code-analysis-strands-api-dev',
  });

  // Test that health endpoint exists
  template.hasResourceProperties('AWS::ApiGateway::Resource', {
    PathPart: 'health',
  });

  // Test that analyze endpoint exists
  template.hasResourceProperties('AWS::ApiGateway::Resource', {
    PathPart: 'analyze',
  });
});

test('Lambda Layer Created', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that Lambda layer is created
  template.hasResourceProperties('AWS::Lambda::LayerVersion', {
    Description: 'Strands Agents SDK and dependencies for code analysis',
    CompatibleRuntimes: ['python3.12'],
  });
});

test('IAM Permissions for Bedrock and S3', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that both Bedrock and S3 permissions are added in the same policy
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: [
        {
          Action: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream'
          ],
          Effect: 'Allow',
          Resource: '*'
        },
        {
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:ListBucket'
          ],
          Effect: 'Allow',
          Resource: '*'
        }
      ]
    }
  });
});

test('Lambda Layer has Correct Properties', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that Lambda layer has correct runtime compatibility
  template.hasResourceProperties('AWS::Lambda::LayerVersion', {
    Description: 'Strands Agents SDK and dependencies for code analysis',
    CompatibleRuntimes: ['python3.12'],
  });
});

test('Lambda Function has Environment Variables', () => {
  const app = new cdk.App();
  const stack = new KiroStrands.KiroStrandsStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that Lambda function has correct environment variables
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: {
        ENVIRONMENT: 'dev'
      }
    }
  });
});
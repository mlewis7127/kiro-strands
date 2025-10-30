import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface KiroStrandsStackProps extends cdk.StackProps {
  environment?: string;
}

export class KiroStrandsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: KiroStrandsStackProps) {
    super(scope, id, props);

    const environment = props?.environment || 'dev';

    // Paths to packaged Lambda assets
    const packagingDirectory = path.join(__dirname, "../packaging");
    const zipDependencies = path.join(packagingDirectory, "dependencies.zip");
    const zipApp = path.join(packagingDirectory, "app.zip");

    // Create a Lambda layer with Strands Agent dependencies
    const dependenciesLayer = new lambda.LayerVersion(this, 'StrandsAgentDependenciesLayer', {
      code: lambda.Code.fromAsset(zipDependencies),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Strands Agents SDK and dependencies for code analysis',
    });

    // Define the Lambda function
    const codeAnalysisFunction = new lambda.Function(this, 'CodeAnalysisStrandsAgent', {
      runtime: lambda.Runtime.PYTHON_3_12,
      functionName: `code-analysis-strands-agent-${environment}`,
      handler: 'agent_handler.handler',
      code: lambda.Code.fromAsset(zipApp),
      timeout: cdk.Duration.seconds(60), // Increased timeout for AI processing
      memorySize: 1024, // Increased memory for AI workloads
      layers: [dependenciesLayer],
      architecture: lambda.Architecture.ARM_64, // ARM64 for better price/performance
      environment: {
        ENVIRONMENT: environment,
      },
      description: `Code Analysis Strands Agent Lambda Function (${environment})`,
    });

    // Add permissions for Bedrock APIs (required for Strands Agents)
    codeAnalysisFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream'
        ],
        resources: ['*'],
      }),
    );

    // Add permissions for S3 (for code analysis from S3)
    codeAnalysisFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket'
        ],
        resources: ['*'], // In production, restrict to specific buckets
      }),
    );

    // Note: CloudWatch Log Group is automatically created by the Lambda function

    // REST API Gateway
    const api = new apigateway.RestApi(this, 'CodeAnalysisStrandsApi', {
      restApiName: `code-analysis-strands-api-${environment}`,
      description: `REST API for Code Analysis Strands Agent (${environment})`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: environment,
        metricsEnabled: true,
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(codeAnalysisFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // Health endpoint
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', lambdaIntegration);

    // Analyze endpoint
    const analyzeResource = api.root.addResource('analyze');
    analyzeResource.addMethod('POST', lambdaIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: codeAnalysisFunction.functionName,
      description: 'Lambda function name',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: codeAnalysisFunction.functionArn,
      description: 'Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'LayerArn', {
      value: dependenciesLayer.layerVersionArn,
      description: 'Strands Agent dependencies layer ARN',
    });
  }
}
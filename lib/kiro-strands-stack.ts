import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
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

    // Create S3 buckets for input and output
    const inputBucket = new s3.Bucket(this, 'CodeAnalysisInputBucket', {
      bucketName: `code-analysis-input-${environment}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environments
      autoDeleteObjects: true, // For dev environments
      eventBridgeEnabled: true, // Enable EventBridge notifications
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    const outputBucket = new s3.Bucket(this, 'CodeAnalysisOutputBucket', {
      bucketName: `code-analysis-output-${environment}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environments
      autoDeleteObjects: true, // For dev environments
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // Add permissions for S3 buckets
    codeAnalysisFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket'
        ],
        resources: [
          inputBucket.bucketArn,
          `${inputBucket.bucketArn}/*`,
          outputBucket.bucketArn,
          `${outputBucket.bucketArn}/*`,
        ],
      }),
    );

    // Create EventBridge rule for S3 object creation events
    const s3EventRule = new events.Rule(this, 'S3ObjectCreatedRule', {
      ruleName: `code-analysis-s3-events-${environment}`,
      description: 'Trigger code analysis when files are uploaded to S3',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [inputBucket.bucketName],
          },
          object: {
            key: [
              { suffix: '.py' },
              { suffix: '.js' },
              { suffix: '.ts' },
              { suffix: '.java' },
              { suffix: '.cpp' },
              { suffix: '.c' },
              { suffix: '.cs' },
              { suffix: '.php' },
              { suffix: '.rb' },
              { suffix: '.go' },
              { suffix: '.rs' },
              { suffix: '.kt' },
              { suffix: '.swift' },
              { suffix: '.scala' },
              { suffix: '.r' },
              { suffix: '.sql' },
              { suffix: '.sh' },
              { suffix: '.yaml' },
              { suffix: '.yml' },
              { suffix: '.json' },
              { suffix: '.xml' },
              { suffix: '.html' },
              { suffix: '.css' },
              { suffix: '.md' },
              { suffix: '.txt' },
            ],
          },
        },
      },
    });

    // Add Lambda function as target for EventBridge rule
    s3EventRule.addTarget(new targets.LambdaFunction(codeAnalysisFunction, {
      event: events.RuleTargetInput.fromObject({
        source: 'eventbridge',
        eventType: 's3-object-created',
        bucket: events.EventField.fromPath('$.detail.bucket.name'),
        key: events.EventField.fromPath('$.detail.object.key'),
        size: events.EventField.fromPath('$.detail.object.size'),
        etag: events.EventField.fromPath('$.detail.object.etag'),
        timestamp: events.EventField.fromPath('$.time'),
        outputBucket: outputBucket.bucketName,
      }),
    }));

    // Add environment variables for bucket names
    codeAnalysisFunction.addEnvironment('INPUT_BUCKET_NAME', inputBucket.bucketName);
    codeAnalysisFunction.addEnvironment('OUTPUT_BUCKET_NAME', outputBucket.bucketName);

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

    new cdk.CfnOutput(this, 'InputBucketName', {
      value: inputBucket.bucketName,
      description: 'S3 bucket for uploading code files to analyze',
    });

    new cdk.CfnOutput(this, 'OutputBucketName', {
      value: outputBucket.bucketName,
      description: 'S3 bucket where analysis results are stored',
    });

    new cdk.CfnOutput(this, 'EventBridgeRuleName', {
      value: s3EventRule.ruleName,
      description: 'EventBridge rule for S3 object creation events',
    });
  }
}
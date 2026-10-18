import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  UserPool,
  type UserPoolClient,
} from 'aws-cdk-lib/aws-cognito';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';

class BeehappyStack extends Stack {
  constructor(scope: App, id: string, props: StackProps & { stage: string }) {
    super(scope, id, props);
    const key = process.env['OPENROUTER_API_KEY'];
    if (!key) throw new Error('OPENROUTER_API_KEY is required.');
    const users = new UserPool(this, 'Users', {
      userPoolName: `Beehappy-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      featurePlan: FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const prefix = `beehappy-${props.stage}-${this.account}`;
    const domain = users.addDomain('HostedUi', {
      cognitoDomain: { domainPrefix: prefix },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const client = users.addClient('Web', {
      generateSecret: false,
      authFlows: { userSrp: true, adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: ['https://placeholder.invalid/auth/callback'],
        logoutUrls: ['https://placeholder.invalid/'],
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      refreshTokenRotationGracePeriod: Duration.seconds(0),
    });
    const branding = new CfnManagedLoginBranding(this, 'ManagedLogin', {
      userPoolId: users.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    branding.node.addDependency(domain);
    const table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const logs = new LogGroup(this, 'ApiLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const api = new LambdaFunction(this, 'Api', {
      runtime: Runtime.PROVIDED_AL2023,
      architecture: Architecture.ARM_64,
      handler: 'bootstrap',
      code: Code.fromAsset(join(__dirname, '../../api/target/lambda/api')),
      memorySize: 1769,
      timeout: Duration.seconds(29),
      logGroup: logs,
      environment: { TABLE_NAME: table.tableName, OPENROUTER_API_KEY: key, RUST_LOG: 'info' },
    });
    table.grantReadWriteData(api);
    const http = new HttpApi(this, 'HttpApi');
    http.addRoutes({
      path: '/api/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('Api', api),
      authorizer: new HttpJwtAuthorizer(
        'Users',
        `https://cognito-idp.${this.region}.amazonaws.com/${users.userPoolId}`,
        { jwtAudience: [client.userPoolClientId] },
      ),
    });
    const site = new Bucket(this, 'Site', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const hostedUi = `https://${prefix}.auth.${this.region}.amazoncognito.com`;
    const headers = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "img-src 'self' data:",
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com ${hostedUi}`,
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
            "script-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            `form-action 'self' ${hostedUi}`,
          ].join('; '),
          override: true,
        },
      },
    });
    const rewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) r.uri = '/index.html'; return r; }",
      ),
    });
    const cdn = new Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: rewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new HttpOrigin(`${http.apiId}.execute-api.${this.region}.amazonaws.com`, {
            protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    const siteUrl = `https://${cdn.distributionDomainName}`;
    this.clientUrls(client, users.userPoolId, siteUrl);
    const webDist = join(__dirname, '../../../dist/apps/web/browser');
    const stamp = createHash('sha256')
      .update(readFileSync(join(webDist, 'index.html')))
      .digest('hex')
      .slice(0, 16);
    const files = new BucketDeployment(this, 'SiteFiles', {
      sources: [Source.asset(webDist, { exclude: ['config.json'] })],
      destinationBucket: site,
      distribution: cdn,
      distributionPaths: ['/*'],
    });
    const config = new BucketDeployment(this, 'RuntimeConfig', {
      sources: [
        Source.jsonData('config.json', {
          auth: {
            authority: `https://cognito-idp.${this.region}.amazonaws.com/${users.userPoolId}`,
            clientId: client.userPoolClientId,
            domain: hostedUi,
          },
        }),
      ],
      destinationBucket: site,
      distribution: cdn,
      distributionPaths: ['/config.json'],
      prune: false,
      cacheControl: [CacheControl.noCache()],
      metadata: { site: stamp },
    });
    config.node.addDependency(files);
    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ApiFunctionName', { value: api.functionName });
  }
  private clientUrls(client: UserPoolClient, userPoolId: string, siteUrl: string): void {
    const call = {
      service: 'CognitoIdentityServiceProvider',
      action: 'updateUserPoolClient',
      parameters: {
        UserPoolId: userPoolId,
        ClientId: client.userPoolClientId,
        CallbackURLs: [`${siteUrl}/auth/callback`],
        LogoutURLs: [`${siteUrl}/`],
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: ['openid', 'email', 'profile'],
        AllowedOAuthFlowsUserPoolClient: true,
        SupportedIdentityProviders: ['COGNITO'],
        ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_ADMIN_USER_PASSWORD_AUTH'],
        PreventUserExistenceErrors: 'ENABLED',
        EnableTokenRevocation: true,
        AccessTokenValidity: 60,
        IdTokenValidity: 60,
        RefreshTokenValidity: 30,
        TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' },
        RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 0 },
      },
      physicalResourceId: PhysicalResourceId.of(client.userPoolClientId),
    };
    new AwsCustomResource(this, 'ClientUrls', {
      installLatestAwsSdk: true,
      onCreate: call,
      onUpdate: call,
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });
  }
}
const account = process.env['CDK_DEFAULT_ACCOUNT'];
if (!account) throw new Error('CDK_DEFAULT_ACCOUNT is required.');
const stage = process.env['STAGE'] ?? 'prod';
if (!/^[a-z][a-z0-9-]{0,20}$/.test(stage))
  throw new Error('STAGE must be a short lowercase stage name.');
new BeehappyStack(new App(), `Beehappy-${stage}`, { stage, env: { account, region: 'us-east-2' } });

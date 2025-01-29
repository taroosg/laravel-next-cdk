import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import {
  Certificate,
  CertificateValidation
} from 'aws-cdk-lib/aws-certificatemanager';

import * as ses from 'aws-cdk-lib/aws-ses';
import { Identity, DkimIdentity, MailFromBehaviorOnMxFailure } from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';

import {
  ListenerAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';

import {
  Vpc,
  SubnetType,
  Port,
  SecurityGroup,
  Peer,
  InstanceType,
  InstanceClass,
  InstanceSize,
} from 'aws-cdk-lib/aws-ec2';

import {
  Cluster,
  FargateTaskDefinition,
  FargateService,
  ContainerImage,
  Protocol,
  AwsLogDriver,
  Secret as ECSSecret,
} from 'aws-cdk-lib/aws-ecs';

import {
  ApplicationLoadBalancer,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';

import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  MysqlEngineVersion,
  Credentials,
  StorageType,
} from 'aws-cdk-lib/aws-rds';

import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dotenv from 'dotenv';

dotenv.config();

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //
    // VPC
    //
    const vpc = new Vpc(this, 'MyVpc', {
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
        },
        {
          name: 'Private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    //  Route 53 & ACM
    const hostedZone = route53.HostedZone.fromLookup(this, 'MyHostedZone', {
      domainName: process.env.DOMAIN_NAME ?? '',
    });

    // "api.mydomain.com" 用の証明書を作成
    const certificate = new Certificate(this, 'ApiCertificate', {
      domainName: 'api.' + process.env.DOMAIN_NAME,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    // SES ドメインアイデンティティを作成
    const emailIdentity = new ses.EmailIdentity(this, 'DomainEmailIdentity', {
      identity: ses.Identity.publicHostedZone(hostedZone),
      dkimIdentity: ses.DkimIdentity.easyDkim(),
      // メール用サブドメインの設定（うまくいってない）
      // mailFromDomain: 'mail.' + process.env.DOMAIN_NAME,
      mailFromBehaviorOnMxFailure: MailFromBehaviorOnMxFailure.REJECT_MESSAGE,
    });

    // メール用サブドメインの設定（うまくいってない）
    // new route53.MxRecord(this, 'MailFromMx', {
    //   zone: hostedZone,
    //   recordName: `mail.${process.env.DOMAIN_NAME}`,
    //   values: [
    //     { priority: 10, hostName: 'feedback-smtp.us-east-1.amazonaws.com' },
    //   ],
    // });
    // new route53.TxtRecord(this, 'MailFromSpf', {
    //   zone: hostedZone,
    //   recordName: `mail.${process.env.DOMAIN_NAME}`,
    //   values: [
    //     'v=spf1 include:amazonses.com -all',
    //   ],
    // });


    // Cognito ユーザープール
    const userPool = new cognito.UserPool(this, 'MyUserPool', {
      userPoolName: 'laravel-user-pool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient('MyUserPoolClient', {
      userPoolClientName: 'laravel-user-pool-appclient',
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
    });

    //
    // RDS (MySQL) を作成
    //   - Private サブネットに配置
    //   - パスワードは Secrets Manager に自動生成
    //
    const dbSecurityGroup = new SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    const dbInstance = new DatabaseInstance(this, 'MyRdsInstance', {
      engine: DatabaseInstanceEngine.mysql({ version: MysqlEngineVersion.VER_8_0 }),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      multiAz: false,
      allocatedStorage: 20,
      storageType: StorageType.GP2,
      credentials: Credentials.fromGeneratedSecret('admin'), // Secrets Managerに保存
      databaseName: 'laravel',
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    //
    // S3 バケットの作成（Laravelのファイル保存用など）
    //
    const s3Bucket = new Bucket(this, 'MyLaravelBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    //
    // ECR リポジトリ (Laravel アプリの Docker イメージを格納)
    //
    const backendRepo = new Repository(this, 'BackendEcrRepo', {
      repositoryName: 'laravel-backend-repo',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    //
    // ECS クラスタ
    //
    const cluster = new Cluster(this, 'MyEcsCluster', {
      vpc,
      clusterName: 'my-ecs-cluster',
    });

    const albSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', { vpc });
    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'Allow HTTP');

    //
    // ALB
    //
    const alb = new ApplicationLoadBalancer(this, 'MyAlb', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    // HTTP リスナー (80)
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // HTTPS リスナー (443)
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      open: true,
      certificates: [ certificate ],
    });

    // HTTP リクエストを HTTPS にリダイレクト
    httpListener.addAction('HttpRedirect', {
      action: ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
      }),
    });

    //
    // Fargate Task Definition (Laravelコンテナ)
    //
    // DB接続情報のパスワードは Secrets Manager から取得
    const dbSecret = dbInstance.secret;
    if (!dbSecret) {
      throw new Error('dbInstance.secret is undefined. Make sure credentials are properly generated.');
    }

    const backendTaskDef = new FargateTaskDefinition(this, 'BackendTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    // SES へのアクセス権限を付与
    backendTaskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
      ],
      resources: ['*'],
    }));

    // S3へのアクセス権限を付与
    s3Bucket.grantReadWrite(backendTaskDef.taskRole);

    // コンテナ定義
    const backendContainer = backendTaskDef.addContainer('BackendContainer', {
      image: ContainerImage.fromEcrRepository(backendRepo, 'latest'),
      logging: new AwsLogDriver({
        streamPrefix: 'laravel-backend',
      }),
      environment: {
        // 環境変数は平文でOKなものを指定
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_DATABASE: 'laravel',
        DB_USERNAME: 'admin',
        AWS_BUCKET: s3Bucket.bucketName,
        AWS_DEFAULT_REGION: this.region,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: this.region,
        APP_ENV: 'production',
        LOG_CHANNEL: 'stderr',
        APP_KEY: process.env.LARAVEL_API_KEY ?? '',
      },
      secrets: {
        DB_PASSWORD: ECSSecret.fromSecretsManager(dbSecret, 'password'),
      },
    });

    backendContainer.addPortMappings({
      containerPort: 80,
      protocol: Protocol.TCP,
    });

    // ECSのサービス用SG
    const serviceSecurityGroup = new SecurityGroup(this, 'BackendServiceSG', { vpc });
    // ALB から 80 へのトラフィックを許可
    serviceSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(80));
    // RDSへのアクセス(3306)を許可
    dbSecurityGroup.addIngressRule(serviceSecurityGroup, Port.tcp(3306), 'Allow MySQL from ECS');

    //
    // Fargate Service (コンテナ起動設定)
    //
    const backendService = new FargateService(this, 'BackendService', {
      cluster,
      serviceName: 'BackendService',
      taskDefinition: backendTaskDef,
      securityGroups: [serviceSecurityGroup],
      // 初回のみ0で実行 → Dockerイメージをビルドし、ECRにプッシュ → 以降1にしてcdk deploy
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableExecuteCommand: true,
    });

    // ALB リスナー → ECS サービスをターゲットに登録
    httpsListener.addTargets('BackendTargetGroup', {
      port: 80,
      targets: [backendService],
      healthCheck: {
        path: '/health_check',
        healthyHttpCodes: '200',
      },
    });

    //  Route53 Alias Record
    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      recordName: 'api',  // => "api.mydomain.com"
      target: route53.RecordTarget.fromAlias(
        new route53_targets.LoadBalancerTarget(alb)
      ),
    });

    //
    // 出力
    //
    new CfnOutput(this, 'DomainUrl', {
      value: 'https://api.' + process.env.DOMAIN_NAME,
      description: 'ALB custom domain URL',
    });

    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'Access your Laravel app at this DNS name',
    });

    new CfnOutput(this, 'RdsEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'RDS MySQL Endpoint',
    });

    new CfnOutput(this, 'S3BucketName', {
      value: s3Bucket.bucketName,
      description: 'S3 bucket for file storage',
    });

    new CfnOutput(this, 'BackendRepositoryUri', {
      value: backendRepo.repositoryUri,
      description: 'ECR repository URI for the Laravel backend',
    });
  }
}

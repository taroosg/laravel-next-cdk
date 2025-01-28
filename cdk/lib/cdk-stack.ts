import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

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
  ApplicationProtocol,
  ApplicationTargetGroup,
  ApplicationListener,
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
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';

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

    // --- Cognito ユーザープール ---
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
      databaseName: 'laravel', // デフォルトDB名
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

    // HTTP リスナー (HTTPS使う場合は別途ACM証明書を設定)
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
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
        APP_KEY: 'base64:9SYDdnYX3i/4llaegD0fFLvFuPM1SoEA/cWJU+zxP1U=',
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
      taskDefinition: backendTaskDef,
      securityGroups: [serviceSecurityGroup],
      // 初回のみ0で実行 → Dockerイメージをビルドし、ECRにプッシュ → 以降1にしてcdk deploy
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // ALB リスナー → ECS サービスをターゲットに登録
    httpListener.addTargets('BackendTargetGroup', {
      port: 80,
      targets: [backendService],
      healthCheck: {
        path: '/health_check',
        healthyHttpCodes: '200',
      },
    });

    //
    // 出力
    //
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

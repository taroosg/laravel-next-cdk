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

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //
    // 1. VPC を作成 (パブリック + プライベートサブネット)
    //
    const vpc = new Vpc(this, 'MyVpc', {
      maxAzs: 2,
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

    //
    // 2. RDS (MySQL) を作成
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
    // 3. S3 バケットの作成（Laravelのファイル保存用など）
    //
    const s3Bucket = new Bucket(this, 'MyLaravelBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    //
    // 4. ECR リポジトリ (Laravel アプリの Docker イメージを格納)
    //
    const backendRepo = new Repository(this, 'BackendEcrRepo', {
      repositoryName: 'laravel-backend-repo',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    //
    // 5. ECS クラスタの作成
    //
    const cluster = new Cluster(this, 'MyEcsCluster', {
      vpc,
      clusterName: 'my-ecs-cluster',
    });

    //
    // 6. ALB (Application Load Balancer) を構築 (パブリック)
    //
    const alb = new ApplicationLoadBalancer(this, 'MyAlb', {
      vpc,
      internetFacing: true,
    });
    const albSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', { vpc });
    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'Allow HTTP');
    alb.addSecurityGroup(albSecurityGroup);

    // HTTP リスナー (HTTPS使う場合は別途ACM証明書を設定)
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    //
    // 7. Fargate Task Definition (Laravelコンテナ) を作成
    //
    // DB接続情報のパスワードは Secrets Manager から取得
    const dbSecret = dbInstance.secret; // RDS で自動生成されたシークレット
    if (!dbSecret) {
      throw new Error('dbInstance.secret is undefined. Make sure credentials are properly generated.');
    }

    const backendTaskDef = new FargateTaskDefinition(this, 'BackendTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

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
        S3_BUCKET: s3Bucket.bucketName,
        // APP_ENV: 'production',
      },
      secrets: {

        DB_PASSWORD: ECSSecret.fromSecretsManager(dbSecret, 'password'),
      },
    });

    backendContainer.addPortMappings({
      containerPort: 8000,
      protocol: Protocol.TCP,
    });

    //
    // 8. Fargate Service (コンテナ起動設定)
    //
    const backendService = new FargateService(this, 'BackendService', {
      cluster,
      taskDefinition: backendTaskDef,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    // ECSのサービス用SG
    const serviceSecurityGroup = new SecurityGroup(this, 'BackendServiceSG', { vpc });
    // ALB から 8000 へのトラフィックを許可
    serviceSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(8000));
    backendService.connections.addSecurityGroup(serviceSecurityGroup);

    // RDSへのアクセス(3306)を許可
    dbSecurityGroup.addIngressRule(serviceSecurityGroup, Port.tcp(3306), 'Allow MySQL from ECS');

    // S3 への操作権限を付与 (読み書き)
    s3Bucket.grantReadWrite(backendTaskDef.taskRole);

    // ALB リスナー → ECS サービスをターゲットに登録
    httpListener.addTargets('BackendTargetGroup', {
      port: 80,
      targets: [backendService],
      healthCheck: {
        path: '/', // ルートパスにアクセス (Laravelのルーティングに合わせる)
        healthyHttpCodes: '200',
      },
    });

    //
    // 9. 出力
    //
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

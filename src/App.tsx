import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  VideoCameraOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type {
  AppConfigStatus,
  AppRuntimeConfig,
  ExecutionItem,
  GeneratedContent,
  GenerationRequest,
  NewsArticle,
  ProgressEvent
} from './types/global';
import {
  assetAPI,
  configAPI,
  dialogAPI,
  generationAPI,
  onGenerationProgress,
  shellAPI,
  systemAPI
} from './services/electronAPI';

const { Header, Content, Sider } = Layout;
const { Text, Title, Paragraph } = Typography;

const HISTORY_STORAGE_KEY = 'finance-video-history-v1';
const API_KEY_LINKS = {
  marketaux: 'https://www.marketaux.com/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  dashscope: 'https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key'
};

interface FormValues {
  topic: string;
  maxArticles: number;
  requestRounds: number;
  durationSeconds: number;
  outputDir: string;
  tone: string;
  contentPrompt: string;
}

type ConfigFormValues = AppRuntimeConfig;

interface PreviewAssets {
  cover?: string;
  video?: string;
}

const sourceColumns: ColumnsType<NewsArticle> = [
  {
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    render: (value: string, record) => (
      <Space direction="vertical" size={2}>
        <Text strong>{value}</Text>
        <Text type="secondary">{record.description ?? record.snippet}</Text>
      </Space>
    )
  },
  {
    title: '来源',
    dataIndex: 'source',
    key: 'source',
    width: 130,
    render: (value?: string) => value || '-'
  },
  {
    title: '时间',
    dataIndex: 'publishedAt',
    key: 'publishedAt',
    width: 180,
    render: (value?: string) => (value ? new Date(value).toLocaleString() : '-')
  }
];

const menuItems = [
  { key: 'generate', icon: <PlayCircleOutlined />, label: '生成任务' },
  { key: 'settings', icon: <SettingOutlined />, label: '接口与模型' },
  { key: 'running', icon: <ClockCircleOutlined />, label: '正在执行' },
  { key: 'history', icon: <HistoryOutlined />, label: '历史' }
];

export default function App() {
  const [form] = Form.useForm<FormValues>();
  const [configForm] = Form.useForm<ConfigFormValues>();
  const [config, setConfig] = useState<AppConfigStatus | null>(null);
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; version?: string; error?: string } | null>(null);
  const [progress, setProgress] = useState<ProgressEvent>({ phase: 'idle', message: '等待开始', percent: 0 });
  const [showProgress, setShowProgress] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeKey, setActiveKey] = useState('generate');
  const [executions, setExecutions] = useState<ExecutionItem[]>(() => readHistory());
  const [selectedExecution, setSelectedExecution] = useState<ExecutionItem | null>(null);
  const [previewAssets, setPreviewAssets] = useState<PreviewAssets>({});
  const [assetLoading, setAssetLoading] = useState(false);

  const apiReady = useMemo(
    () => Boolean(config?.hasMarketauxApiKey && config?.hasDeepseekApiKey && config?.hasAlibabaDashscopeApiKey),
    [config]
  );
  const runningItems = useMemo(() => executions.filter((item) => item.status === 'running'), [executions]);
  const completedItems = useMemo(() => executions.filter((item) => item.status !== 'running'), [executions]);

  useEffect(() => {
    void refreshStatus();
    const unsubscribe = onGenerationProgress((event) => setProgress(event));
    return unsubscribe;
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(executions.slice(0, 50)));
  }, [executions]);

  async function refreshStatus() {
    const [configStatus, ffmpegStatus] = await Promise.all([configAPI.get(), systemAPI.checkFfmpeg()]);
    setConfig(configStatus);
    setFfmpeg(ffmpegStatus);
    configForm.setFieldsValue(configStatus.settings);
    form.setFieldsValue({
      topic: 'broad global finance macro markets liquidity commodities technology supply chain',
      maxArticles: 12,
      requestRounds: 4,
      durationSeconds: 60,
      outputDir: configStatus.defaultOutputDir,
      tone: 'Objective, restrained, high-information-density broad finance analysis for mainland Chinese stock-market retail audiences. Explain macro, overseas markets, liquidity, commodities, technology cycle and risk sentiment only. Do not recommend stocks, sectors, tickers, trades, prices or returns.',
      contentPrompt: configStatus.settings.contentPrompt
    });
  }

  async function saveRuntimeConfig(values: ConfigFormValues) {
    setSavingConfig(true);
    try {
      const saved = await configAPI.save(values);
      setConfig(saved);
      configForm.setFieldsValue(saved.settings);
      form.setFieldValue('contentPrompt', saved.settings.contentPrompt);
      message.success('接口、模型和提示词配置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingConfig(false);
    }
  }

  async function selectOutputDir() {
    const selected = await dialogAPI.selectOutputDir();
    if (selected) form.setFieldValue('outputDir', selected);
  }

  async function runGeneration(values: FormValues) {
    if (!apiReady) {
      message.error('请先在“接口与模型”中配置 Marketaux、DeepSeek 和 DashScope API Key');
      return;
    }
    if (ffmpeg && !ffmpeg.available) {
      message.error('未检测到 FFmpeg，无法生成可播放视频');
      return;
    }

    const topic = values.topic.trim();
    if (!topic) {
      message.error('请输入财经主题');
      return;
    }

    const request: GenerationRequest = {
      topic,
      maxArticles: values.maxArticles,
      requestRounds: values.requestRounds,
      durationSeconds: values.durationSeconds,
      outputDir: values.outputDir,
      tone: values.tone,
      contentPrompt: values.contentPrompt
    };
    const executionId = `${Date.now()}`;

    setLoading(true);
    setShowProgress(true);
    setActiveKey('running');
    setProgress({ phase: 'running', message: '开始执行', percent: 5 });
    setExecutions((current) => [
      {
        id: executionId,
        title: '生成中：财经资讯视频',
        status: 'running',
        createdAt: new Date().toLocaleString(),
        outputDir: values.outputDir,
        summary: topic
      },
      ...current
    ]);

    try {
      const generated = await generationAPI.run(request);
      const finishedItem: ExecutionItem = {
        id: executionId,
        title: generated.publishTitle,
        status: 'done',
        createdAt: new Date().toLocaleString(),
        outputDir: generated.outputDir,
        summary: generated.summary,
        content: generated
      };
      setExecutions((current) => current.map((item) => (item.id === executionId ? finishedItem : item)));
      setSelectedExecution(finishedItem);
      await loadPreviewAssets(finishedItem);
      setActiveKey('history');
      message.success('内容和视频已生成');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setProgress({ phase: 'error', message: reason, percent: 100 });
      setExecutions((current) => current.map((item) => (
        item.id === executionId
          ? { ...item, status: 'failed', title: '生成失败', summary: reason }
          : item
      )));
      message.error(reason);
    } finally {
      setLoading(false);
    }
  }

  async function openPreview(item: ExecutionItem) {
    setSelectedExecution(item);
    await loadPreviewAssets(item);
  }

  async function loadPreviewAssets(item: ExecutionItem) {
    setPreviewAssets({});
    if (!item.content) return;

    setAssetLoading(true);
    try {
      const [cover, video] = await Promise.all([
        item.content.coverImagePath ? assetAPI.getDataUrl(item.content.coverImagePath).catch(() => undefined) : undefined,
        item.content.videoPath ? assetAPI.getDataUrl(item.content.videoPath).catch(() => undefined) : undefined
      ]);
      setPreviewAssets({ cover, video });
    } finally {
      setAssetLoading(false);
    }
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" width={220}>
        <div className="sider-brand">
          <VideoCameraOutlined />
          <div>
            <div className="sider-title">AI财经资讯视频</div>
            <div className="sider-subtitle">发布工作台</div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          onClick={({ key }) => setActiveKey(key)}
        />
      </Sider>

      <Layout className="app-main">
        <Header className="app-header">
          <Space size={12} align="center" className="brand-group">
            <div className="brand-mark">
              <VideoCameraOutlined />
            </div>
            <div className="brand-copy">
              <Title level={4} className="app-title">AI财经资讯视频</Title>
              <Text type="secondary" className="app-subtitle">国外财经新闻到合规中文短视频资产的本地工作台</Text>
            </div>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={refreshStatus}>刷新状态</Button>
        </Header>

        <Content className="app-content">
          {activeKey === 'generate' && (
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={16}>
                <Card title="生成任务" className="panel-card">
                  <Form form={form} layout="vertical" onFinish={runGeneration}>
                    <Form.Item
                      name="topic"
                      label="财经主题"
                      extra="建议用英文描述财经大类，不写股票代码。例如 broad global finance macro markets liquidity commodities technology supply chain。"
                      rules={[{ required: true, message: '请输入财经主题' }]}
                    >
                      <Input.TextArea rows={4} placeholder="broad global finance macro markets liquidity commodities technology supply chain" />
                    </Form.Item>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="maxArticles" label="最终新闻数">
                          <InputNumber min={5} max={40} className="full-width" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="requestRounds" label="请求轮次">
                          <InputNumber min={1} max={6} className="full-width" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="durationSeconds" label="目标秒数">
                          <InputNumber min={30} max={180} className="full-width" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="tone" label="口播风格">
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item
                      name="contentPrompt"
                      label="本次新闻分析提示词"
                      extra="默认读取接口与模型里的全局提示词；这里修改只影响本次生成。"
                      rules={[{ required: true, message: '请输入 DeepSeek 内容生成提示词' }]}
                    >
                      <Input.TextArea rows={8} />
                    </Form.Item>
                    <Form.Item
                      name="outputDir"
                      label="输出目录"
                      rules={[{ required: true, message: '请选择输出目录' }]}
                    >
                      <Input addonAfter={<Button type="text" icon={<FolderOpenOutlined />} onClick={selectOutputDir} />} />
                    </Form.Item>
                    <div className="config-actions">
                      <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={loading} size="large">
                        开始执行
                      </Button>
                    </div>
                  </Form>
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Space direction="vertical" size={16} className="full-width">
                  <Card title="状态摘要" className="panel-card">
                    <Row gutter={[12, 12]}>
                      <Col span={12}>
                        <Statistic title="Marketaux" value={config?.hasMarketauxApiKey ? '已配置' : '缺失'} prefix={<ApiOutlined />} />
                      </Col>
                      <Col span={12}>
                        <Statistic title="DeepSeek" value={config?.hasDeepseekApiKey ? '已配置' : '缺失'} prefix={<CheckCircleOutlined />} />
                      </Col>
                      <Col span={12}>
                        <Statistic title="DashScope" value={config?.hasAlibabaDashscopeApiKey ? '已配置' : '缺失'} prefix={<KeyOutlined />} />
                      </Col>
                    </Row>
                    <Divider />
                    <Statistic title="FFmpeg" value={ffmpeg?.available ? '可用' : '未装'} />
                    <Divider />
                    <Text type="secondary">默认输出目录</Text>
                    <Paragraph copyable className="compact-paragraph">{config?.defaultOutputDir}</Paragraph>
                    <Divider />
                    <Text type="secondary">当前脚本模型</Text>
                    <Paragraph className="compact-paragraph">{config?.settings.deepseekScriptModel}</Paragraph>
                  </Card>

                  <Card title="合规说明" className="panel-card">
                    <Alert
                      type="info"
                      showIcon
                      message="财经大类模式"
                      description="内容只做公开资讯整理和宏观/市场情绪解读，不输出股票代码、荐股、买卖建议、目标价或收益暗示。"
                    />
                    {!apiReady && (
                      <Alert
                        style={{ marginTop: 12 }}
                        type="warning"
                        showIcon
                        message="API Key 未完整读取"
                        description="请到“接口与模型”里保存 Marketaux、DeepSeek 和 DashScope Key。"
                      />
                    )}
                    {ffmpeg && !ffmpeg.available && (
                      <Alert
                        style={{ marginTop: 12 }}
                        type="info"
                        showIcon
                        message="视频合成需要 FFmpeg"
                        description={ffmpeg.error}
                      />
                    )}
                  </Card>
                </Space>
              </Col>
            </Row>
          )}

          {activeKey === 'settings' && (
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={16}>
                <Card title="接口与模型" className="panel-card">
                  <Form form={configForm} layout="vertical" onFinish={saveRuntimeConfig}>
                    <Row gutter={12}>
                      <Col xs={24} lg={8}>
                        <Form.Item
                          name="marketauxApiKey"
                          label="Marketaux API Key"
                          extra={<Button type="link" className="inline-link-button" onClick={() => shellAPI.openExternal(API_KEY_LINKS.marketaux)}>申请 Marketaux Key</Button>}
                        >
                          <Input.Password placeholder="用于抓取海外财经新闻" autoComplete="off" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={8}>
                        <Form.Item
                          name="deepseekApiKey"
                          label="DeepSeek API Key"
                          extra={<Button type="link" className="inline-link-button" onClick={() => shellAPI.openExternal(API_KEY_LINKS.deepseek)}>申请 DeepSeek Key</Button>}
                        >
                          <Input.Password placeholder="用于生成脚本和封面 HTML" autoComplete="off" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={8}>
                        <Form.Item
                          name="alibabaDashscopeApiKey"
                          label="DashScope 语音 Key"
                          extra={<Button type="link" className="inline-link-button" onClick={() => shellAPI.openExternal(API_KEY_LINKS.dashscope)}>申请 DashScope Key</Button>}
                        >
                          <Input.Password placeholder="用于生成固定声音口播" autoComplete="off" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left">DeepSeek</Divider>
                    <Row gutter={12}>
                      <Col xs={24} md={12}>
                        <Form.Item name="deepseekScriptModel" label="新闻分析/脚本模型" rules={[{ required: true, message: '请输入脚本模型' }]}>
                          <Input placeholder="deepseek-v4-pro" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="deepseekCoverModel" label="封面 HTML 模型" rules={[{ required: true, message: '请输入封面模型' }]}>
                          <Input placeholder="deepseek-v4-pro" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="deepseekScriptTemperature" label="脚本温度">
                          <InputNumber min={0} max={2} step={0.05} className="full-width" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="deepseekCoverTemperature" label="封面温度">
                          <InputNumber min={0} max={2} step={0.05} className="full-width" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left">DashScope TTS</Divider>
                    <Row gutter={12}>
                      <Col xs={24} md={8}>
                        <Form.Item name="dashscopeTtsModel" label="语音模型" rules={[{ required: true, message: '请输入语音模型' }]}>
                          <Input placeholder="qwen3-tts-flash" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="dashscopeTtsVoice" label="声音">
                          <Input placeholder="Cherry" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="ttsTimeoutMs" label="语音超时（毫秒）">
                          <InputNumber min={5000} max={180000} step={5000} className="full-width" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left">提示词</Divider>
                    <Form.Item
                      name="contentPrompt"
                      label="新闻资讯分析提示词"
                      extra="这是每个用户最常调整的核心提示词，会作为生成任务里的默认值。"
                      rules={[{ required: true, message: '请输入新闻资讯分析提示词' }]}
                    >
                      <Input.TextArea rows={8} />
                    </Form.Item>
                    <Form.Item name="scriptSystemPrompt" label="脚本系统提示词" rules={[{ required: true, message: '请输入脚本系统提示词' }]}>
                      <Input.TextArea rows={4} />
                    </Form.Item>
                    <Form.Item name="coverSystemPrompt" label="封面系统提示词" rules={[{ required: true, message: '请输入封面系统提示词' }]}>
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item name="coverPromptExtra" label="封面额外提示词">
                      <Input.TextArea rows={4} />
                    </Form.Item>

                    <div className="config-actions">
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingConfig} size="large">
                        保存配置
                      </Button>
                    </div>
                  </Form>
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Space direction="vertical" size={16} className="full-width">
                  <Card title="配置状态" className="panel-card">
                    <Row gutter={[12, 12]}>
                      <Col span={12}>
                        <Statistic title="Marketaux" value={config?.hasMarketauxApiKey ? '已配置' : '缺失'} prefix={<ApiOutlined />} />
                      </Col>
                      <Col span={12}>
                        <Statistic title="DeepSeek" value={config?.hasDeepseekApiKey ? '已配置' : '缺失'} prefix={<CheckCircleOutlined />} />
                      </Col>
                      <Col span={12}>
                        <Statistic title="DashScope" value={config?.hasAlibabaDashscopeApiKey ? '已配置' : '缺失'} prefix={<KeyOutlined />} />
                      </Col>
                    </Row>
                  </Card>
                  <Card title="Key 安全说明" className="panel-card">
                    <Alert
                      type="info"
                      showIcon
                      message="仅保存在用户本地"
                      description="API Key 只会保存到当前电脑的应用本地配置中，不会上传到我们的云端。生成内容时，Key 仅用于请求 Marketaux、DeepSeek 和 DashScope 对应服务。"
                    />
                  </Card>
                </Space>
              </Col>
            </Row>
          )}

          {activeKey === 'running' && (
            <Card className="panel-card">
              <div className="section-head">
                <Text strong>正在执行</Text>
                <Tag color={loading ? 'processing' : 'default'}>{loading ? '生成中' : '空闲'}</Tag>
              </div>
              {loading || runningItems.length > 0 ? (
                <Space direction="vertical" size={14} className="full-width">
                  <Progress percent={progress.percent} status={progress.phase === 'error' ? 'exception' : undefined} />
                  <Text>{progress.message}</Text>
                  <List
                    dataSource={runningItems}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta title={item.title} description={item.summary} />
                        <Tag color="processing">running</Tag>
                      </List.Item>
                    )}
                  />
                </Space>
              ) : (
                <Empty description="还没有正在执行的任务" />
              )}
            </Card>
          )}

          {activeKey === 'history' && (
            <Card className="panel-card">
              <div className="section-head">
                <Text strong>历史</Text>
                <Tag>{completedItems.length} 条</Tag>
              </div>
              {completedItems.length === 0 ? (
                <Empty description="暂无历史记录" />
              ) : (
                <List
                  dataSource={completedItems}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="preview" type="link" icon={<EyeOutlined />} onClick={() => openPreview(item)} disabled={!item.content}>
                          预览
                        </Button>,
                        <Button key="open" type="link" onClick={() => item.outputDir && shellAPI.openPath(item.outputDir)}>
                          打开目录
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={item.title}
                        description={
                          <Space direction="vertical" size={4}>
                            <Text type="secondary">{item.createdAt}</Text>
                            <Text>{item.summary}</Text>
                            {item.content?.videoPath && <Text type="secondary">视频：{item.content.videoPath}</Text>}
                          </Space>
                        }
                      />
                      <Tag color={item.status === 'done' ? 'green' : 'red'}>{item.status}</Tag>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          )}
        </Content>
      </Layout>

      <Modal
        title="生成进度"
        open={showProgress}
        onCancel={() => setShowProgress(false)}
        footer={loading ? null : <Button onClick={() => setShowProgress(false)}>关闭</Button>}
        closable={!loading}
        maskClosable={!loading}
        width={520}
      >
        <Progress percent={progress.percent} status={progress.phase === 'error' ? 'exception' : undefined} />
        <Divider />
        <Text>{progress.message}</Text>
      </Modal>

      <Modal
        title="历史预览"
        open={Boolean(selectedExecution)}
        onCancel={() => setSelectedExecution(null)}
        footer={[
          <Button key="open" onClick={() => selectedExecution?.outputDir && shellAPI.openPath(selectedExecution.outputDir)}>
            打开目录
          </Button>,
          <Button key="close" type="primary" onClick={() => setSelectedExecution(null)}>
            关闭
          </Button>
        ]}
        width={980}
      >
        {selectedExecution?.content ? (
          <Tabs
            items={[
              {
                key: 'publish',
                label: '发布信息',
                children: <PublishPreview content={selectedExecution.content} />
              },
              {
                key: 'cover',
                label: '封面',
                children: (
                  <div className="asset-preview">
                    {assetLoading && <Progress percent={60} showInfo={false} />}
                    {previewAssets.cover ? (
                      <img className="cover-preview" src={previewAssets.cover} alt="封面预览" />
                    ) : (
                      <Empty description="未读取到封面图片" />
                    )}
                  </div>
                )
              },
              {
                key: 'video',
                label: '视频',
                children: (
                  <div className="asset-preview">
                    {assetLoading && <Progress percent={60} showInfo={false} />}
                    {previewAssets.video ? (
                      <video className="video-preview" src={previewAssets.video} controls />
                    ) : (
                      <Empty description="未读取到视频文件" />
                    )}
                  </div>
                )
              },
              {
                key: 'sources',
                label: '新闻来源',
                children: (
                  <Table
                    rowKey={(record, index) => record.uuid || record.url || `${record.title}-${index}`}
                    dataSource={selectedExecution.content.sourceArticles ?? []}
                    columns={sourceColumns}
                    pagination={{ pageSize: 5 }}
                    size="small"
                  />
                )
              }
            ]}
          />
        ) : (
          <Empty description="这条记录没有可预览内容" />
        )}
      </Modal>
    </Layout>
  );
}

function PublishPreview({ content }: { content: GeneratedContent }) {
  return (
    <Space direction="vertical" size={14} className="full-width">
      <div>
        <Text type="secondary">抖音标题（{Array.from(content.publishTitle ?? '').length}/30）</Text>
        <Paragraph copyable strong>{content.publishTitle}</Paragraph>
      </div>
      <div>
        <Text type="secondary">作品简介（{Array.from(content.publishContent ?? '').length}/1000）</Text>
        <Paragraph copyable>{content.publishContent}</Paragraph>
      </div>
      <div>
        <Text type="secondary">标签</Text>
        <div className="tag-list">
          {(content.hashtags ?? []).map((tag) => <Tag key={tag}>#{tag}</Tag>)}
        </div>
      </div>
      <div>
        <Text type="secondary">封面描述</Text>
        <Paragraph copyable>{content.coverDescription}</Paragraph>
      </div>
      <div>
        <Text type="secondary">口播文字</Text>
        {(content.scenes ?? []).map((scene, index) => (
          <Paragraph key={`${scene.title}-${index}`} copyable>
            {index + 1}. {scene.narration}
          </Paragraph>
        ))}
      </div>
    </Space>
  );
}

function readHistory(): ExecutionItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

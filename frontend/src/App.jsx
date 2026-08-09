import React, { useState, useRef, useEffect } from 'react';
import SmartGuide from './components/SmartGuide';
import ProposalManagement from './components/ProposalManagement';
import OperationPlanManagement from './components/OperationPlanManagement';
import LineIntelligencePanel from './components/LineIntelligencePanel';
import AIUsagePanel from './components/AIUsagePanel';
import LineIntelligenceHealthPanel from './components/LineIntelligenceHealthPanel';
import ConversionApiKeyPanel from './components/ConversionApiKeyPanel';
import LiffReferralConfigPanel from './components/LiffReferralConfigPanel';
import LiffReferralPage from './components/LiffReferralPage';
import ReferralGrowthPanel from './components/ReferralGrowthPanel';
import TrackedUriTool from './components/TrackedUriTool';
import { emitGuideEvent } from './guide-events';
import { 
  LayoutDashboard, 
  FolderKanban, 
  LayoutTemplate, 
  Users, 
  Settings, 
  Menu, 
  Bell, 
  Search, 
  Plus,
  ChevronDown,
  LogOut,
  Smartphone,
  ArrowLeft,
  Image as ImageIcon,
  Link,
  MessageSquare,
  MousePointerClick,
  Sparkles,
  UploadCloud,
  CheckCircle2,
  Loader2
} from 'lucide-react';

const NAVIGATION = [
  { id: 'dashboard', label: '總覽', icon: LayoutDashboard },
  { id: 'projects', label: '圖文選單專案', icon: FolderKanban },
  { id: 'templates', label: '模板中心', icon: LayoutTemplate },
  { id: 'ai-usage', label: 'AI \u7528\u91cf', icon: Sparkles },
  { id: 'intelligence-health', label: 'LINE Health', icon: MousePointerClick },
  { id: 'accounts', label: '客戶帳號', icon: Users },
  { id: 'tenant-inventory', label: '租戶資料盤點', icon: Search },
  { id: 'tenant-integrity', label: '租戶健康檢查', icon: CheckCircle2 },
  { id: 'members', label: '團隊成員', icon: Users },
  { id: 'settings', label: '品牌設定', icon: Settings },
];

const PRODUCTION_WORKER_BASE_URL =
  import.meta.env.VITE_PRODUCTION_WORKER_BASE_URL ||
  'https://smart-menu-backend.fangwl591021.workers.dev';
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? PRODUCTION_WORKER_BASE_URL : 'http://127.0.0.1:8788');
const apiUrl = (path = '') => `${API_BASE_URL}${path}`;

const AUTH_TOKEN_KEY = 'smart_menu_auth_token';

const FRONTEND_BUILD = 'tenant-transfer-engine-v2.6.0';

const getAuthToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || '';

const authFetch = (path, options = {}) => {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(apiUrl(path), {
    ...options,
    headers,
  });
};

const apiMemoryCache = new Map();

const cachedAuthJson = async (path, ttlMs = 10000) => {
  const now = Date.now();
  const cached = apiMemoryCache.get(path);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const res = await authFetch(path);
  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || 'API 讀取失敗');
  }

  apiMemoryCache.set(path, {
    data,
    expiresAt: now + ttlMs,
  });

  return data;
};

const clearApiCache = (prefix = '') => {
  for (const key of apiMemoryCache.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      apiMemoryCache.delete(key);
    }
  }
};


const AuthImage = ({ src, alt = '', className = '' }) => {
  const [objectUrl, setObjectUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let localUrl = '';

    const load = async () => {
      if (!src) {
        setObjectUrl('');
        return;
      }

      try {
        setFailed(false);
        const res = await authFetch(src);
        if (!res.ok) throw new Error('圖片讀取失敗');
        const blob = await res.blob();
        localUrl = URL.createObjectURL(blob);
        if (!cancelled) setObjectUrl(localUrl);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setObjectUrl('');
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [src]);

  if (!src || failed || !objectUrl) {
    return (
      <div className={`${className} bg-gray-100 flex items-center justify-center`}>
        <LayoutTemplate size={20} className="text-gray-400" />
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} className={className} />;
};

const DashboardView = ({ onNavigate }) => (
  <div className="space-y-6 animate-in fade-in duration-500">
    <div className="flex justify-between items-center">
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">品牌營運總覽</h2>
      <button 
        onClick={() => onNavigate('projects')}
        className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
        <Plus size={16} />
        建立新選單
      </button>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {[
        { title: '啟用中的選單', value: '3', desc: '包含 12 個頁面' },
        { title: '本月發布次數', value: '18', desc: '剩餘 82 次' },
        { title: '綁定官方帳號', value: '1', desc: '正常連線中' }
      ].map((stat, i) => (
        <div key={i} className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 mb-2">{stat.title}</h3>
          <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
          <p className="text-sm text-gray-500 mt-1">{stat.desc}</p>
        </div>
      ))}
    </div>

    <div className="mt-8 p-8 bg-blue-50 rounded-xl border border-blue-100 flex flex-col md:flex-row items-center justify-between">
      <div>
        <h3 className="text-lg font-bold text-blue-900 mb-2">準備好迎接即將到來的母親節了嗎？</h3>
        <p className="text-blue-700 max-w-xl">使用我們的「節慶營運套組」模板，5 分鐘內建立包含首頁、活動頁與商品展示的多頁圖文選單。</p>
      </div>
      <button className="mt-4 md:mt-0 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors shadow-sm">
        前往模板中心
      </button>
    </div>
  </div>
);


const ProjectsView = ({ onStartNew, onEditProject }) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyProjectId, setBusyProjectId] = useState('');
  const [query, setQuery] = useState('');

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/projects');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '專案查詢失敗');
      setProjects(data.projects || []);
    } catch (e) {
      console.error(e);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const runProjectAction = async (project, action, successMessage, confirmMessage = '') => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusyProjectId(project.id);
    try {
      const res = await authFetch(`/api/projects/${project.id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '操作失敗');
      alert(successMessage);
      await loadProjects();
    } catch (e) {
      console.error(e);
      alert(`操作失敗：${e.message}`);
    } finally {
      setBusyProjectId('');
    }
  };

  const rows = projects.filter(p =>
    String(p.name || '').toLowerCase().includes(query.trim().toLowerCase())
  );
  const enabledProjectCount = projects.filter(project => project.status !== 'disabled').length;

  const statusView = (project) => {
    if (project.status === 'default') return { label: '預設首頁', className: 'bg-blue-100 text-blue-700' };
    if (project.status === 'published') return { label: '已發布', className: 'bg-green-100 text-green-700' };
    if (project.status === 'disabled') return { label: '已停用', className: 'bg-red-100 text-red-700' };
    return { label: '草稿', className: 'bg-gray-100 text-gray-700' };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">圖文選單專案</h2>
          <p className="text-gray-500 text-sm mt-1">每個 Project 代表一個選單頁；發布各頁後，再指定其中一頁為預設首頁。</p>
        </div>
        <button
          onClick={onStartNew}
          className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          新增專案
        </button>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        發布順序：① 建立並設定各頁 → ② 逐頁發布以建立 Alias → ③ 選擇一個已發布頁面設為預設首頁。
      </div>

      {enabledProjectCount < 2 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-4">
          <span>切換頁至少需要 2 個啟用中的 Project。請先建立第二個專案，再設定彼此的「切換頁」Action。</span>
          <button onClick={onStartNew} className="shrink-0 font-bold text-amber-900 underline">新增第二頁</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-6 py-4 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋專案名稱..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            />
          </div>
          <button onClick={loadProjects} className="text-sm text-blue-600 hover:text-blue-800 font-medium">重新整理</button>
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center text-gray-500 gap-2">
            <Loader2 size={18} className="animate-spin" />
            載入專案中...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <FolderKanban size={36} className="mx-auto text-gray-300 mb-3" />
            <div className="font-bold text-gray-700">目前還沒有專案</div>
            <div className="text-sm text-gray-500 mt-1">點「新增專案」，從模板快速建立第一個客戶專案。</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rows.map((project) => {
              const status = statusView(project);
              const busy = busyProjectId === project.id;
              const published = project.status === 'published' || project.status === 'default';
              const disabled = project.status === 'disabled';

              return (
                <div key={project.id} className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                  <button onClick={() => onEditProject(project.id)} className="flex items-center gap-4 text-left min-w-0">
                    <div className="w-20 h-14 shrink-0 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 flex items-center justify-center text-gray-400">
                      {project.imageUrl ? (
                        <AuthImage src={project.imageUrl} alt={project.name} className="w-full h-full object-cover" />
                      ) : (
                        <Smartphone size={20} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 truncate">{project.name}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {project.areaCount || 0} 個熱區 · {project.pageCount || 1} 頁
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.className}`}>{status.label}</span>
                    <button onClick={() => onEditProject(project.id)} className="border border-gray-300 px-3 py-1.5 rounded-md text-xs font-medium text-gray-700 hover:bg-white">編輯</button>
                    {!disabled && (
                      <button
                        disabled={busy}
                        onClick={() => runProjectAction(project, 'publish', project.status === 'default' ? '首頁已重新發布並維持預設。' : '專案已發布並完成 Alias 綁定。')}
                        className="border border-green-300 px-3 py-1.5 rounded-md text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                      >
                        {busy ? '處理中...' : published ? '重新發布' : '發布'}
                      </button>
                    )}
                    {published && !project.isDefault && (
                      <button
                        disabled={busy}
                        onClick={() => runProjectAction(project, 'set-default', '已設為預設首頁。')}
                        className="border border-blue-300 px-3 py-1.5 rounded-md text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        設為首頁
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => runProjectAction(
                        project,
                        disabled ? 'enable' : 'disable',
                        disabled ? '專案已啟用，請重新發布以建立 Alias。' : '專案已停用並解除 Alias。',
                        disabled ? '' : `確定停用「${project.name}」？系統會解除這個頁面的 LINE Alias。`,
                      )}
                      className={`border px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${
                        disabled
                          ? 'border-gray-300 text-gray-700 hover:bg-white'
                          : 'border-red-300 text-red-700 hover:bg-red-50'
                      }`}
                    >
                      {disabled ? '啟用' : '停用'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
const ProjectBuilderView = ({ onBack, onCreated }) => {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/templates');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '模板查詢失敗');
        setTemplates(data.templates || []);
      } catch (e) {
        console.error(e);
        alert('模板讀取失敗：' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const createProject = async () => {
    if (!selectedTemplateId) return alert('請先選擇一套模板。');
    if (!projectName.trim()) return alert('請輸入專案名稱。');

    setCreating(true);
    try {
      const res = await authFetch('/api/projects/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          name: projectName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '建立專案失敗');
      onCreated(data.project.id);
    } catch (e) {
      console.error(e);
      alert('建立專案失敗：' + e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-gray-100 text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">新增圖文選單專案</h2>
          <p className="text-sm text-gray-500 mt-1">先選模板，再建立獨立專案副本。這一步不會呼叫 Gemini。</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="text-sm font-bold text-gray-900 mb-4">① 選擇模板</div>

        {loading ? (
          <div className="py-10 flex justify-center text-gray-500 gap-2">
            <Loader2 size={18} className="animate-spin" />
            載入模板...
          </div>
        ) : templates.length === 0 ? (
          <div className="p-6 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            模板庫目前沒有可用模板，請先到「模板中心」建立模板。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(template => {
              const active = selectedTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    if (!projectName.trim()) setProjectName(`${template.name} - 新專案`);
                  }}
                  className={`text-left border rounded-xl overflow-hidden transition-all ${
                    active
                      ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="aspect-[2500/1686] bg-gray-100 overflow-hidden">
                    {template.imageUrl ? (
                      <AuthImage src={template.imageUrl} alt={template.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <ImageIcon size={32} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="font-bold text-gray-900 text-sm">{template.name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {template.areaCount || 0} 個熱區 · {template.pageCount || 1} 頁
                    </div>
                    <div className="mt-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {active ? '已選擇' : '使用此模板'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="text-sm font-bold text-gray-900 mb-4">② 專案基本資料</div>
        <label className="block text-sm font-medium text-gray-700 mb-2">專案名稱</label>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="例如：ABC Coffee 會員選單"
          className="w-full border border-gray-300 rounded-md py-2.5 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {selectedTemplate && (
          <p className="text-xs text-gray-500 mt-2">
            來源模板：{selectedTemplate.name}。建立後會複製座標與 Action 結構，日後母版修改不會影響此專案。
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={createProject}
          disabled={creating || !selectedTemplateId || !projectName.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-md text-sm font-bold flex items-center gap-2"
        >
          {creating && <Loader2 size={16} className="animate-spin" />}
          建立專案並進入內容設定
        </button>
      </div>
    </div>
  );
};

const PROJECT_ACTION_OPTIONS = [
  { value: 'uri', label: '網址' },
  { value: 'message', label: '文字' },
  { value: 'postback', label: 'Postback' },
  { value: 'richmenuswitch', label: '切換頁' },
];

const PROJECT_ACTION_BADGES = {
  uri: '🔗 網址',
  message: '💬 文字',
  postback: '⚙ Postback',
  richmenuswitch: '↔ 切換頁',
};

const ProjectEditorView = ({ projectId, onBack, onStartNew, onGuideNavigate, userRole }) => {
  const [project, setProject] = useState(null);
  const [switchTargets, setSwitchTargets] = useState([]);
  const [activeArea, setActiveArea] = useState(null);
  const [loading, setLoading] = useState(true);
  const [changingImage, setChangingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposalRefreshKey, setProposalRefreshKey] = useState(0);
  const projectImageInputRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const res = await authFetch(`/api/projects/${projectId}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '專案讀取失敗');
        setProject(data.project);
        setSwitchTargets(data.switchTargets || []);
        setActiveArea(data.project.areas?.[0]?.id || null);
      } catch (e) {
        console.error(e);
        alert('專案讀取失敗：' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);


  const changeProjectImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setChangingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await authFetch(`/api/projects/${projectId}/upload-image`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '圖片更新失敗');

      setProject(prev => ({
        ...prev,
        assetId: data.asset.id,
        imageUrl: data.asset.imageUrl,
      }));
      emitGuideEvent({
        type: 'guide-refresh',
        workflowId: 'rich-menu-project-setup',
        stepId: 'PROJECT_IMAGE',
      });
    } catch (e) {
      console.error(e);
      alert('更換圖片失敗：' + e.message);
    } finally {
      setChangingImage(false);
      event.target.value = '';
    }
  };


  const updateProjectName = (name) => {
    setProject(prev => ({ ...prev, name }));
  };

  const updateProjectAreaAction = (areaId, patch) => {
    setProject(prev => ({
      ...prev,
      areas: (prev.areas || []).map(area =>
        area.id === areaId
          ? {
              ...area,
              action: {
                ...(area.action || { type: 'uri', uri: '' }),
                ...patch,
              },
            }
          : area
      ),
    }));
  };

  const replaceProjectAreaAction = (areaId, action) => {
    setProject(prev => ({
      ...prev,
      areas: (prev.areas || []).map(area =>
        area.id === areaId ? { ...area, action } : area
      ),
    }));
  };

  const changeProjectAreaActionType = (areaId, type) => {
    if (type === 'message') {
      replaceProjectAreaAction(areaId, { type, text: '' });
      return;
    }
    if (type === 'postback') {
      replaceProjectAreaAction(areaId, { type, data: '', displayText: '' });
      return;
    }
    if (type === 'richmenuswitch') {
      const target = switchTargets[0];
      replaceProjectAreaAction(areaId, {
        type,
        targetPageId: target?.id || '',
        richMenuAliasId: target?.richMenuAliasId || '',
        data: target?.richMenuAliasId ? `switch:${target.richMenuAliasId}` : '',
      });
      return;
    }
    replaceProjectAreaAction(areaId, { type: 'uri', uri: '' });
  };

  const changeRichMenuSwitchTarget = (areaId, targetPageId) => {
    const target = switchTargets.find(item => item.id === targetPageId);
    replaceProjectAreaAction(areaId, {
      type: 'richmenuswitch',
      targetPageId: target?.id || '',
      richMenuAliasId: target?.richMenuAliasId || '',
      data: target?.richMenuAliasId ? `switch:${target.richMenuAliasId}` : '',
    });
  };

  const saveProject = async () => {
    if (!project?.name?.trim()) {
      return alert('請輸入專案名稱。');
    }

    setSaving(true);
    try {
      const res = await authFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.name.trim(),
          areas: project.areas || [],
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '專案儲存失敗');
      }

      emitGuideEvent({
        type: 'guide-refresh',
        workflowId: 'rich-menu-project-setup',
        stepId: 'PROJECT_ACTIONS',
      });
      alert('專案內容已儲存。');
    } catch (e) {
      console.error(e);
      alert('專案儲存失敗：' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshProjectFromServer = async () => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '專案讀取失敗');
      setProject(payload.project);
      setSwitchTargets(payload.switchTargets || []);
    } catch (error) {
      console.error('Project refresh after Proposal operation failed', error);
    }
  };

  const handleProposalExecuted = (operation) => {
    const plan = operation?.plan;
    if (plan?.operationType === 'SET_PROJECT_AREA_DISPLAY_TEXT') {
      setProject(previous => ({
        ...previous,
        areas: (previous?.areas || []).map(area => String(area.id) === String(plan.target?.areaIndex)
          ? {
              ...area,
              action: {
                ...(area.action || {}),
                displayText: plan.mutation?.after || '',
              },
            }
          : area),
      }));
    } else if (plan?.operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS') {
      void refreshProjectFromServer();
    }
    setProposalRefreshKey(value => value + 1);
    emitGuideEvent({
      type: 'guide-refresh',
      workflowId: 'rich-menu-project-setup',
      stepId: 'PROJECT_ACTIONS',
    });
  };

  const handleProposalRolledBack = (rollback) => {
    const plan = rollback?.plan;
    if (plan?.operationType === 'SET_PROJECT_AREA_DISPLAY_TEXT') {
      setProject(previous => ({
        ...previous,
        areas: (previous?.areas || []).map(area => String(area.id) === String(plan.target?.areaIndex)
          ? {
              ...area,
              action: {
                ...(area.action || {}),
                displayText: plan.mutation?.restoreTo || '',
              },
            }
          : area),
      }));
    } else if (plan?.operationType === 'UPGRADE_PROJECT_AREA_URI_TO_HTTPS') {
      void refreshProjectFromServer();
    }
    setProposalRefreshKey(value => value + 1);
    emitGuideEvent({
      type: 'guide-refresh',
      workflowId: 'rich-menu-project-setup',
      stepId: 'PROJECT_ACTIONS',
    });
  };

  const focusGuideTarget = (target) => {
    const areaTarget = /^project-area-(.+)-(action-type|uri|message|postback-data|switch-target)$/.exec(target);
    if (areaTarget) {
      const targetArea = project?.areas?.find(area => String(area.id) === areaTarget[1]);
      if (targetArea) setActiveArea(targetArea.id);
    }

    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const element = document.querySelector(`[data-guide-target="${target}"]`);
        if (!element) {
          resolve(false);
          return;
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-4', 'ring-amber-300', 'ring-offset-2');
        window.setTimeout(() => element.classList.remove('ring-4', 'ring-amber-300', 'ring-offset-2'), 1800);
        resolve(true);
      }));
    });
  };

  const handleGuideAction = async (nextAction) => {
    if (nextAction?.type === 'focus' || nextAction?.type === 'review') return focusGuideTarget(nextAction.target);
    if (nextAction?.type === 'navigate' && String(nextAction.target || '').startsWith('intelligence-')) return focusGuideTarget(nextAction.target);
    if (nextAction?.type === 'navigate') return Boolean(onGuideNavigate?.(nextAction.target));
    return false;
  };

  if (loading) {
    return <div className="py-20 flex justify-center items-center gap-2 text-gray-500"><Loader2 size={20} className="animate-spin" />載入專案...</div>;
  }

  if (!project) {
    return <div className="p-8 text-center text-gray-500">找不到專案。</div>;
  }

  const currentArea = project.areas?.find(a => a.id === activeArea);
  const action = currentArea?.action || { type: 'uri', uri: '' };

  const availableSwitchTargets = switchTargets;

  const fieldDescription = (() => {
    if (action.type === 'uri') return '開啟客戶指定網址';
    if (action.type === 'message') return '點擊後傳送指定文字';
    if (action.type === 'postback') return '送出流程 Data，可選擇是否顯示文字';
    if (action.type === 'richmenuswitch') return '切換到同一 Workspace 的另一個 Project 頁面';
    return '請選擇此區域的動作類型';
  })();

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-full hover:bg-gray-100 text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <div>
            <input
              value={project.name || ''}
              onChange={(e) => updateProjectName(e.target.value)}
              className="font-bold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none bg-transparent px-0 py-0.5 min-w-[280px]"
            />
            <div className="text-xs text-gray-500 mt-1">專案內容設定 · 已從模板建立獨立快照</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={projectImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={changeProjectImage}
          />
          <button
            data-guide-target="project-image"
            onClick={() => projectImageInputRef.current?.click()}
            disabled={changingImage}
            className="border border-gray-300 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-md text-sm font-medium text-gray-700 flex items-center gap-2"
          >
            {changingImage ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
            更換專案圖片
          </button>
          <button
            onClick={saveProject}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            儲存專案
          </button>
          <span className={`text-xs px-2.5 py-1 rounded-full ${
            project.status === 'default'
              ? 'bg-blue-100 text-blue-700'
              : project.status === 'published'
                ? 'bg-green-100 text-green-700'
                : project.status === 'disabled'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-700'
          }`}>
            {project.status === 'default' ? '預設首頁' : project.status === 'published' ? '已發布' : project.status === 'disabled' ? '已停用' : '草稿'}
          </span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
        <div className="bg-white border-r border-gray-200 overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="font-bold text-gray-900 mb-2">請完成客戶內容</h3>
            <p className="text-sm text-gray-500">模板提供圖片、座標、區域名稱與預設 Action；此專案可獨立調整每個區域的最終動作，不會回寫模板。</p>
          </div>

          <div data-guide-target="project-areas" className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {(project.areas || []).map(area => (
              <button
                key={area.id}
                onClick={() => setActiveArea(area.id)}
                className={`py-2 px-2 text-xs font-medium rounded-md border ${
                  activeArea === area.id
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {area.label}
              </button>
            ))}
          </div>

          {currentArea && (
            <div className="border border-gray-200 rounded-xl p-5 space-y-4 shadow-sm">
              <div>
                <div className="font-bold text-gray-900">設定【{currentArea.label}】</div>
                <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>
              </div>

              <div data-guide-target={`project-area-${currentArea.id}-action-type`}>
                <label className="block text-sm font-medium text-gray-700 mb-1">動作類型</label>
                <select
                  value={action.type || 'uri'}
                  onChange={(e) => changeProjectAreaActionType(currentArea.id, e.target.value)}
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {PROJECT_ACTION_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {action.type === 'uri' && (
                <div data-guide-target={`project-area-${currentArea.id}-uri`}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">網址</label>
                  <input
                    value={action.uri || ''}
                    onChange={(e) => updateProjectAreaAction(currentArea.id, { uri: e.target.value })}
                    placeholder="https://..."
                    className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">只修改此專案，不會影響模板母版。</p>
                  <TrackedUriTool projectId={projectId} areaId={currentArea.id} originalDestination={action.uri || ''} request={authFetch} userRole={userRole} />
                </div>
              )}

              {action.type === 'message' && (
                <div data-guide-target={`project-area-${currentArea.id}-message`}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">傳送文字</label>
                  <textarea
                    value={action.text || ''}
                    onChange={(e) => updateProjectAreaAction(currentArea.id, { text: e.target.value })}
                    placeholder="例如：我要預約"
                    rows={3}
                    className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">只修改此專案，不會影響模板母版。</p>
                  <TrackedUriTool projectId={projectId} areaId={currentArea.id} originalDestination={action.uri || ''} request={authFetch} userRole={userRole} />
                </div>
              )}

              {action.type === 'postback' && (
                <div className="space-y-3">
                  <div data-guide-target={`project-area-${currentArea.id}-postback-data`}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
                    <input
                      value={action.data || ''}
                      onChange={(e) => updateProjectAreaAction(currentArea.id, { data: e.target.value })}
                      placeholder="action=security_info"
                      className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">顯示文字（選填）</label>
                    <input
                      value={action.displayText || ''}
                      onChange={(e) => updateProjectAreaAction(currentArea.id, { displayText: e.target.value })}
                      placeholder="例如：查看中騰保全"
                      className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {action.type === 'richmenuswitch' && (
                <div className="space-y-3">
                  <div data-guide-target={`project-area-${currentArea.id}-switch-target`}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">目標頁面</label>
                    <select
                      value={action.targetPageId || ''}
                      onChange={(e) => changeRichMenuSwitchTarget(currentArea.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">請選擇目標頁面</option>
                      {availableSwitchTargets.map(target => (
                        <option key={target.id} value={target.id}>
                          {target.name}{target.id === project.id ? '（目前專案）' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {availableSwitchTargets.length === 0 ? (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 space-y-2">
                      <div>切換頁至少需要另一個啟用中的 Project。</div>
                      <button type="button" onClick={onStartNew} className="font-bold underline">新增第二個專案</button>
                    </div>
                  ) : (
                    <div className="rounded-md bg-green-50 border border-green-100 p-3 text-xs text-green-800">
                      系統會自動建立目標 alias 與 switch data，不需要手動輸入技術參數。
                    </div>
                  )}
                </div>
              )}

              {action.type === 'none' && (
                <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600">
                  此區塊不建立點擊動作。
                </div>
              )}
            </div>
          )}
          <LineIntelligencePanel projectId={projectId} request={authFetch} userRole={userRole} />
          <ProposalManagement
            projectId={projectId}
            project={project}
            userRole={userRole}
            request={authFetch}
            refreshKey={proposalRefreshKey}
            onExecuted={handleProposalExecuted}
            onRolledBack={handleProposalRolledBack}
          />
          <OperationPlanManagement
            projectId={projectId}
            request={authFetch}
            refreshKey={proposalRefreshKey}
          />
        </div>

        <div className="bg-gray-100 p-8 flex items-center justify-center overflow-y-auto">
          <div className="w-[350px] bg-white rounded-[40px] shadow-2xl border-[8px] border-gray-800 overflow-hidden">
            <div className="h-16 bg-[#06C755] px-4 flex items-center text-white font-bold">LINE 預覽</div>
            <div className="aspect-[2500/1686] relative bg-gray-200">
              {project.imageUrl && <AuthImage src={project.imageUrl} alt={project.name} className="w-full h-full object-contain" />}
              {(project.areas || []).map(area => (
                <button
                  key={area.id}
                  onClick={() => setActiveArea(area.id)}
                  style={area.style}
                  className={`absolute border border-red-500 ${
                    activeArea === area.id ? 'bg-red-500/35' : 'bg-red-500/10 hover:bg-red-500/20'
                  }`}
                  title={`${area.label} · ${PROJECT_ACTION_BADGES[area.action?.type] || '未設定'}`}
                >
                  <span className="absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded bg-black/70 px-1.5 py-0.5 text-[9px] leading-tight text-white pointer-events-none">
                    {area.label} · {PROJECT_ACTION_BADGES[area.action?.type] || '未設定'}
                  </span>
                </button>
              ))}
            </div>
            <div className="h-10 border-t border-gray-200 flex items-center justify-center text-sm text-gray-700">選單</div>
          </div>
        </div>
      </div>
      <SmartGuide
        projectId={projectId}
        selectedAreaId={activeArea}
        request={authFetch}
        onAction={handleGuideAction}
        userRole={userRole}
        onProposalSaved={() => setProposalRefreshKey(value => value + 1)}
      />
    </div>
  );
};




const LoginView = ({ onLoggedIn }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!login.trim() || !password) {
      setError('請輸入帳號與密碼。');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: login.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || '登入失敗');
      }

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      onLoggedIn();
    } catch (e) {
      console.error(e);
      setError(e.message || '登入失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-8 py-8 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center font-bold">SM</div>
            <div>
              <div className="font-bold text-xl text-gray-900">Smart Menu Studio</div>
              <div className="text-sm text-gray-500 mt-0.5">Workspace 登入</div>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">帳號或 Email</label>
            <input
              autoFocus
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="輸入帳號或 Email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="輸入密碼"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-black hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg py-2.5 font-bold text-sm flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            登入
          </button>

          <p className="text-xs text-gray-500 leading-relaxed">
            新成員請使用管理員建立的帳號與初始密碼登入；LINE UID 之後再進行綁定。
          </p>
        </form>
      </div>
    </div>
  );
};

const AccountView = ({ session, onSessionChanged }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const changePassword = async () => {
    if (newPassword.length < 8) return alert('新密碼至少需要 8 個字元。');
    if (newPassword !== confirmPassword) return alert('兩次輸入的新密碼不一致。');

    setSaving(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '密碼修改失敗');

      if (data.token) localStorage.setItem(AUTH_TOKEN_KEY, data.token);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await onSessionChanged?.();
      alert('密碼已更新。');
    } catch (e) {
      console.error(e);
      alert('密碼修改失敗：' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">我的帳號</h2>
        <p className="text-sm text-gray-500 mt-1">查看目前登入身份並管理密碼。</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs text-gray-500">使用者</div>
            <div className="font-semibold text-gray-900 mt-1">{session?.user?.display_name || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Workspace</div>
            <div className="font-semibold text-gray-900 mt-1">
              {session?.memberships?.find(x => x.workspace_id === session?.activeWorkspaceId)?.workspace_name || session?.activeWorkspaceId || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">角色</div>
            <div className="font-semibold text-gray-900 mt-1">{session?.activeRole || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">LINE UID</div>
            <div className="font-semibold text-gray-900 mt-1">{session?.user?.line_user_id || '尚未綁定'}</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 max-w-2xl">
        <h3 className="font-bold text-gray-900">修改密碼</h3>
        <div className="mt-4 space-y-4">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="目前密碼"
            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新密碼，至少 8 個字元"
            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次輸入新密碼"
            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm"
          />
          <button
            onClick={changePassword}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            更新密碼
          </button>
        </div>
      </div>
    </div>
  );
};


const LineHubView = ({ member, onBack, projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingTarget, setSavingTarget] = useState('');
  const [keywordForm, setKeywordForm] = useState({
    keyword: '',
    matchType: 'exact',
    targetId: '',
  });
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [simMessage, setSimMessage] = useState('');
  const [simMode, setSimMode] = useState('routing');
  const [simResult, setSimResult] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [creatingKeyword, setCreatingKeyword] = useState(false);

  const [accountForm, setAccountForm] = useState({
    oaName: '',
    lineLoginChannelId: '',
    lineLoginChannelSecret: '',
    lineBotChannelId: '',
    lineBotChannelAccessToken: '',
    lineBotChannelSecret: '',
    lineBotBasicId: '',
    status: 'disconnected',
    webhookEnabled: true,
  });

  const loadHub = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/line-hub');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'LINE Hub 讀取失敗');

      setData(json);

      const a = json.lineAccount || {};
      setAccountForm({
        oaName: a.oaName || '',
        lineLoginChannelId: a.lineLoginChannelId || '',
        lineLoginChannelSecret: '',
        lineBotChannelId: a.lineBotChannelId || '',
        lineBotChannelAccessToken: '',
        lineBotChannelSecret: '',
        lineBotBasicId: a.lineBotBasicId || '',
        status: a.status || 'disconnected',
        webhookEnabled: a.webhookEnabled !== false,
      });

      if (!keywordForm.targetId && json.targets?.length) {
        setKeywordForm(prev => ({
          ...prev,
          targetId: json.targets[0].id,
        }));
      }
    } catch (e) {
      console.error(e);
      alert('LINE Hub 讀取失敗：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHub();
  }, []);

  const saveAccount = async () => {
    setSavingAccount(true);
    try {
      const res = await authFetch('/api/line-hub/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountForm),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'LINE OA 設定失敗');

      await loadHub();
      emitGuideEvent({
        type: 'guide-refresh',
        workflowId: 'rich-menu-project-setup',
        stepId: accountForm.lineBotChannelAccessToken ? 'LINE_BOT_TOKEN' : 'LINE_ACCOUNT',
      });
      alert('LINE OA 設定已儲存。');
    } catch (e) {
      console.error(e);
      alert('LINE OA 設定失敗：' + e.message);
    } finally {
      setSavingAccount(false);
    }
  };

  const updateTarget = async (target, patch) => {
    setSavingTarget(target.id);
    try {
      const res = await authFetch(`/api/line-hub/targets/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: patch.name ?? target.name,
          targetType: patch.target_type ?? target.target_type,
          endpointUrl: patch.endpoint_url ?? target.endpoint_url,
          enabled: patch.enabled ?? Boolean(target.enabled),
          canReply: patch.can_reply ?? Boolean(target.can_reply),
          forwardSignature: patch.forward_signature ?? Boolean(target.forward_signature),
          timeoutMs: patch.timeout_ms ?? target.timeout_ms,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Target 更新失敗');

      setData(prev => ({
        ...prev,
        targets: prev.targets.map(t =>
          t.id === target.id ? { ...t, ...patch } : t
        ),
      }));
    } catch (e) {
      console.error(e);
      alert('Target 更新失敗：' + e.message);
    } finally {
      setSavingTarget('');
    }
  };

  const checkKeyword = async () => {
    if (!keywordForm.keyword.trim()) {
      setConflict(null);
      return;
    }

    setChecking(true);
    try {
      const res = await authFetch('/api/line-hub/keywords/check-conflict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keywordForm.keyword.trim(),
          matchType: keywordForm.matchType,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '衝突檢查失敗');
      setConflict(json.conflict || null);
    } catch (e) {
      console.error(e);
      alert('關鍵字衝突檢查失敗：' + e.message);
    } finally {
      setChecking(false);
    }
  };

  const createKeyword = async () => {
    if (!keywordForm.keyword.trim()) return alert('請輸入關鍵字。');
    if (!keywordForm.targetId) return alert('請選擇目標系統。');

    setCreatingKeyword(true);
    try {
      const res = await authFetch('/api/line-hub/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keywordForm.keyword.trim(),
          matchType: keywordForm.matchType,
          targetId: keywordForm.targetId,
          priority: 100,
          enabled: true,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        if (json.conflict) setConflict(json.conflict);
        throw new Error(json.error || '關鍵字建立失敗');
      }

      setKeywordForm(prev => ({
        ...prev,
        keyword: '',
      }));
      setConflict(null);
      await loadHub();
    } catch (e) {
      console.error(e);
      alert('關鍵字建立失敗：' + e.message);
    } finally {
      setCreatingKeyword(false);
    }
  };

  const deleteKeyword = async (route) => {
    if (!confirm(`確定刪除關鍵字「${route.keyword}」？`)) return;

    try {
      const res = await authFetch(`/api/line-hub/keywords/${route.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '刪除失敗');
      await loadHub();
    } catch (e) {
      console.error(e);
      alert('刪除失敗：' + e.message);
    }
  };

  const handleLineHubGuideAction = (action) => {
    const isLineAccountAction = action?.target === 'line-hub' || action?.target === 'line-account-settings';
    if (!isLineAccountAction) return false;

    const element = document.querySelector('[data-guide-target="line-account-settings"]');
    if (!element) return false;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('ring-4', 'ring-amber-300', 'ring-offset-2');
    window.setTimeout(() => element.classList.remove('ring-4', 'ring-amber-300', 'ring-offset-2'), 1800);
    return true;
  };

  if (loading && !data) {
    return (
      <div className="py-20 flex items-center justify-center gap-2 text-gray-500">
        <Loader2 size={18} className="animate-spin" />
        載入 LINE Hub...
      </div>
    );
  }

  const gatewayPath = data?.lineAccount?.webhookPath || '';
  const gatewayUrl = gatewayPath
    ? `${PRODUCTION_WORKER_BASE_URL}${gatewayPath}`
    : '';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">LINE OA / Webhook Hub</h2>
        <p className="text-sm text-gray-500 mt-1">
          LINE 只連到一個 Gateway；System A / B 由 Smart Menu 中央路由，避免關鍵字競爭。
        </p>
      </div>

      <section data-guide-target="line-account-settings" className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-5">
        <div>
          <h3 className="font-bold text-gray-900">LINE OA 串接</h3>
          <p className="text-xs text-gray-500 mt-1">Secret / Token 留空時不會覆蓋既有值。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ['LINE OA 名稱', 'oaName', '例如：ABC Coffee'],
            ['LINE Bot @帳號', 'lineBotBasicId', '@xxxxxxx'],
            ['LINE Login Channel ID', 'lineLoginChannelId', 'Channel ID'],
            ['LINE Login Channel Secret', 'lineLoginChannelSecret', '留空代表不修改'],
            ['LINE Bot Channel ID', 'lineBotChannelId', 'Messaging API Channel ID'],
            ['LINE Bot Channel Access Token', 'lineBotChannelAccessToken', '留空代表不修改'],
            ['LINE Bot Channel Secret', 'lineBotChannelSecret', '留空代表不修改'],
          ].map(([label, key, placeholder]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type={key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') ? 'password' : 'text'}
                value={accountForm[key]}
                onChange={(e) => setAccountForm(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={saveAccount}
            disabled={savingAccount}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2"
          >
            {savingAccount && <Loader2 size={15} className="animate-spin" />}
            儲存 LINE OA 設定
          </button>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900">LINE Gateway Webhook</h3>
        <p className="text-xs text-gray-500 mt-1">
          LINE Developers 只設定這一個 Webhook。System A / B 不直接暴露給 LINE。
        </p>

        <div className="mt-4 flex gap-2">
          <input
            readOnly
            value={gatewayUrl || '尚未產生'}
            className="flex-1 bg-gray-50 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={() => gatewayUrl && navigator.clipboard?.writeText(gatewayUrl)}
            className="border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-md text-sm font-medium"
          >
            複製
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          正式 Worker：{PRODUCTION_WORKER_BASE_URL}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {(data?.targets || []).map(target => (
          <div key={target.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">{target.name}</h3>
                <div className="text-xs text-gray-500 mt-1">
                  {target.position === 1 ? '主系統' : '第二系統 / 備援'}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${target.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {target.enabled ? '啟用' : '停用'}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">系統名稱</label>
              <input
                value={target.name || ''}
                onChange={(e) => setData(prev => ({
                  ...prev,
                  targets: prev.targets.map(t => t.id === target.id ? { ...t, name: e.target.value } : t),
                }))}
                onBlur={() => updateTarget(target, { name: target.name })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
              <input
                value={target.endpoint_url || ''}
                onChange={(e) => setData(prev => ({
                  ...prev,
                  targets: prev.targets.map(t => t.id === target.id ? { ...t, endpoint_url: e.target.value } : t),
                }))}
                onBlur={() => updateTarget(target, { endpoint_url: target.endpoint_url })}
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(target.enabled)}
                  onChange={(e) => updateTarget(target, { enabled: e.target.checked })}
                />
                啟用
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(target.can_reply)}
                  onChange={(e) => updateTarget(target, { can_reply: e.target.checked })}
                />
                可提出回覆內容
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(target.forward_signature)}
                  onChange={(e) => updateTarget(target, { forward_signature: e.target.checked })}
                />
                轉發 LINE Signature
              </label>
            </div>

            {savingTarget === target.id && (
              <div className="text-xs text-blue-600 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                儲存中...
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-5">
        <div>
          <h3 className="font-bold text-gray-900">中央關鍵字路由</h3>
          <p className="text-xs text-gray-500 mt-1">
            同一 Workspace 的關鍵字不可互相競爭；建立前會先檢查 exact / prefix / contains 衝突。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={keywordForm.keyword}
            onChange={(e) => {
              setKeywordForm(prev => ({ ...prev, keyword: e.target.value }));
              setConflict(null);
            }}
            onBlur={checkKeyword}
            placeholder="例如：分享好友"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />

          <select
            value={keywordForm.matchType}
            onChange={(e) => {
              setKeywordForm(prev => ({ ...prev, matchType: e.target.value }));
              setConflict(null);
            }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="exact">完全符合</option>
            <option value="prefix">開頭符合</option>
            <option value="contains">包含</option>
          </select>

          <select
            value={keywordForm.targetId}
            onChange={(e) => setKeywordForm(prev => ({ ...prev, targetId: e.target.value }))}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {(data?.targets || []).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <button
            onClick={createKeyword}
            disabled={creatingKeyword || checking || Boolean(conflict)}
            className="bg-black hover:bg-gray-800 disabled:opacity-50 text-white rounded-md px-4 py-2 text-sm font-bold"
          >
            {checking ? '檢查中...' : creatingKeyword ? '建立中...' : '新增關鍵字'}
          </button>
        </div>

        {keywordForm.keyword && (
          <div>
            {checking ? (
              <div className="text-xs text-gray-500">正在檢查衝突...</div>
            ) : conflict ? (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                衝突：目前「{conflict.keyword}」({conflict.matchType}) 已由 {conflict.targetName} 使用。
              </div>
            ) : (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                此規則目前未發現競爭衝突。
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {(data?.keywordRoutes || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">目前尚未建立關鍵字路由。</div>
          ) : (
            data.keywordRoutes.map(route => (
              <div key={route.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">{route.keyword}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {route.match_type} → {route.target_name}
                  </div>
                </div>
                <button
                  onClick={() => deleteKeyword(route)}
                  className="text-sm text-red-600 hover:text-red-800 font-medium"
                >
                  刪除
                </button>
              </div>
            ))
          )}
        </div>
      </section>
      {projectId && (
        <SmartGuide
          projectId={projectId}
          request={authFetch}
          onAction={handleLineHubGuideAction}
        />
      )}
    </div>
  );
};


const CustomerAccountsView = ({ onOpenWorkspace }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [users, setUsers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    workspaceName: '',
    companyName: '',
    contactName: '',
    phone: '',
    industry: '',
    taxId: '',
    ownerMode: 'new',
    existingUserId: '',
    ownerDisplayName: '',
    ownerUsername: '',
    ownerEmail: '',
    ownerPassword: '',
    removeOldMembership: true,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await cachedAuthJson('/api/system/workspaces', 10000);
      setRows(data.workspaces || []);
    } catch (e) {
      console.error(e);
      setError(e.message || '客戶帳號讀取失敗');
    } finally {
      setLoading(false);
    }
  };


  const loadUsers = async () => {
    try {
      const data = await cachedAuthJson('/api/system/users', 30000);
      setUsers(data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  const createWorkspace = async () => {
    const selectedUser = users.find(u => u.id === createForm.existingUserId);
    const resolvedWorkspaceName = (
      createForm.workspaceName ||
      (createForm.ownerMode === 'existing'
        ? (selectedUser?.display_name || selectedUser?.username || '')
        : '')
    ).trim();

    if (createForm.ownerMode === 'existing' && !createForm.existingUserId) {
      alert('請先選擇既有使用者。');
      return;
    }

    if (!resolvedWorkspaceName) {
      alert('請輸入客戶 / Workspace 名稱。');
      return;
    }

    setCreating(true);

    try {
      let res;

      if (createForm.ownerMode === 'existing') {
        res = await authFetch(
          `/api/system/users/${createForm.existingUserId}/promote-to-workspace`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceName: resolvedWorkspaceName,
              companyName: createForm.companyName || resolvedWorkspaceName,
              contactName: createForm.contactName,
              phone: createForm.phone,
              industry: createForm.industry,
              taxId: createForm.taxId,
              removeOldMembership: createForm.removeOldMembership,
            }),
          }
        );
      } else {
        res = await authFetch('/api/system/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceName: resolvedWorkspaceName,
            companyName: createForm.companyName || resolvedWorkspaceName,
            contactName: createForm.contactName,
            phone: createForm.phone,
            industry: createForm.industry,
            taxId: createForm.taxId,
            existingUserId: '',
            ownerDisplayName: createForm.ownerDisplayName,
            ownerUsername: createForm.ownerUsername,
            ownerEmail: createForm.ownerEmail,
            ownerPassword: createForm.ownerPassword,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '建立客戶失敗');

      clearApiCache('/api/system/workspaces');
      clearApiCache('/api/system/users');

      setShowCreate(false);
      setCreateForm({
        workspaceName: '',
        companyName: '',
        contactName: '',
        phone: '',
        industry: '',
        taxId: '',
        ownerMode: 'new',
        existingUserId: '',
        ownerDisplayName: '',
        ownerUsername: '',
        ownerEmail: '',
        ownerPassword: '',
        removeOldMembership: true,
      });

      await load();
      alert(
        createForm.ownerMode === 'existing'
          ? '既有使用者已轉成正式客戶 Workspace Owner。'
          : '客戶 Workspace 已建立。'
      );
    } catch (e) {
      console.error(e);
      alert(e.message || '建立客戶失敗');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => { load(); loadUsers(); }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">客戶帳號 / Workspace</h2>
          <p className="text-sm text-gray-500 mt-1">
            這裡建立的是「租用客戶」，不是 Workspace 內的團隊成員。
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium">
          + 新增客戶
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h3 className="font-bold text-gray-900">建立客戶 Workspace</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['客戶 / Workspace 名稱','workspaceName'],
              ['公司名稱','companyName'],
              ['聯絡人','contactName'],
              ['電話','phone'],
              ['產業','industry'],
              ['統編','taxId'],
            ].map(([label,key]) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">{label}</label>
                <input value={createForm[key]} onChange={e => setCreateForm(p => ({...p,[key]:e.target.value}))}
                  className="w-full border rounded-md px-3 py-2 text-sm" />
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            <div className="font-medium mb-3">客戶 Owner 登入帳號</div>
            <div className="flex gap-4 text-sm mb-4">
              <label className="flex gap-2 items-center">
                <input type="radio" checked={createForm.ownerMode==='new'}
                  onChange={() => setCreateForm(p => ({...p,ownerMode:'new'}))} />
                建立新 Owner
              </label>
              <label className="flex gap-2 items-center">
                <input type="radio" checked={createForm.ownerMode==='existing'}
                  onChange={() => setCreateForm(p => ({...p,ownerMode:'existing'}))} />
                使用既有使用者
              </label>
            </div>

            {createForm.ownerMode === 'existing' ? (
              <>
              <select value={createForm.existingUserId}
                onChange={e => {
                  const userId = e.target.value;
                  const selected = users.find(u => u.id === userId);
                  setCreateForm(p => ({
                    ...p,
                    existingUserId: userId,
                    workspaceName: p.workspaceName || selected?.display_name || selected?.username || '',
                    companyName: p.companyName || selected?.display_name || selected?.username || '',
                    contactName: p.contactName || selected?.display_name || selected?.username || '',
                  }));
                }}
                className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="">請選擇既有使用者</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} · {u.email || u.username} {u.workspace_names ? `（目前：${u.workspace_names}）` : ''}
                  </option>
                ))}
              </select>
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="font-semibold text-sm text-amber-900">
                  既有使用者會直接升級成新 Workspace 的 Owner
                </div>
                <div className="text-xs text-amber-800 mt-1">
                  原本登入帳號與密碼保留，不重建使用者。
                </div>
                <label className="flex items-center gap-2 text-sm text-amber-900 mt-3">
                  <input
                    type="checkbox"
                    checked={createForm.removeOldMembership}
                    onChange={e => setCreateForm(p => ({...p,removeOldMembership:e.target.checked}))}
                  />
                  建立成功後停用舊 Workspace 的非 Owner membership
                </label>
              </div>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input placeholder="Owner 姓名" value={createForm.ownerDisplayName}
                  onChange={e => setCreateForm(p => ({...p,ownerDisplayName:e.target.value}))}
                  className="border rounded-md px-3 py-2 text-sm" />
                <input placeholder="登入帳號" value={createForm.ownerUsername}
                  onChange={e => setCreateForm(p => ({...p,ownerUsername:e.target.value}))}
                  className="border rounded-md px-3 py-2 text-sm" />
                <input placeholder="Email" value={createForm.ownerEmail}
                  onChange={e => setCreateForm(p => ({...p,ownerEmail:e.target.value}))}
                  className="border rounded-md px-3 py-2 text-sm" />
                <input type="password" placeholder="初始密碼（至少 8 字元）" value={createForm.ownerPassword}
                  onChange={e => setCreateForm(p => ({...p,ownerPassword:e.target.value}))}
                  className="border rounded-md px-3 py-2 text-sm" />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={createWorkspace}
              disabled={creating || (createForm.ownerMode === 'existing' && !createForm.existingUserId)}
              className="bg-blue-600 text-white px-5 py-2 rounded-md text-sm disabled:opacity-50">
              {creating ? '處理中...' : createForm.ownerMode === 'existing' ? '轉成正式客戶 Workspace' : '建立客戶 Workspace'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-500">載入中...</div>
        ) : error ? (
          <div className="p-10 text-center text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">目前沒有客戶 Workspace。</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map(row => (
              <div key={row.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-gray-900">
                    {row.company_name || row.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {row.id} · {row.plan || 'starter'} · 成員 {row.member_count || 0} 人
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    LINE Webhook 啟用：{row.active_webhook_count || 0} 組
                  </div>
                </div>
                <button
                  onClick={() => onOpenWorkspace(row)}
                  className="border border-blue-200 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-md text-sm font-medium"
                >
                  進入帳號
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const WorkspaceAccountView = ({ workspace, onBack }) => {
  const [tab, setTab] = useState('profile');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({});
  const [lineForm, setLineForm] = useState({});
  const [keyword, setKeyword] = useState('');
  const [matchType, setMatchType] = useState('exact');
  const [targetId, setTargetId] = useState('');
  const [conflict, setConflict] = useState(null);
  const [simMessage, setSimMessage] = useState('');
  const [simMode, setSimMode] = useState('routing');
  const [simResult, setSimResult] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [migrationSource, setMigrationSource] = useState('');
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationOptions, setMigrationOptions] = useState({
    copyLine: true,
    copyWebhooks: true,
    copyKeywords: true,
    templateIds: [],
    projectIds: [],
  });

  const load = async () => {
    setLoading(true);
    try {
      const json = await cachedAuthJson(`/api/system/workspaces/${workspace.id}`, 3000);
      setData(json);

      const w = json.workspace || {};
      setProfile({
        workspaceName: w.name || '',
        contactName: w.contact_name || '',
        phone: w.phone || '',
        companyName: w.company_name || w.name || '',
        taxId: w.tax_id || '',
        industry: w.industry || '',
        address: w.address || '',
        notes: w.notes || '',
      });

      const a = json.lineAccount || {};
      setLineForm({
        oaName: a.oaName || '',
        lineLoginChannelId: a.lineLoginChannelId || '',
        lineLoginChannelSecret: '',
        lineBotChannelId: a.lineBotChannelId || '',
        lineBotChannelAccessToken: '',
        lineBotChannelSecret: '',
        lineBotBasicId: a.lineBotBasicId || '',
        status: a.status || 'disconnected',
        webhookEnabled: a.webhookEnabled !== false,
      });

      if (!targetId && json.targets?.length) setTargetId(json.targets[0].id);
    } catch (e) {
      console.error(e);
      alert(e.message || '帳號讀取失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [workspace.id]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '一般資訊儲存失敗');
      clearApiCache(`/api/system/workspaces/${workspace.id}`);
      clearApiCache('/api/system/workspaces');
      await load();
      alert('一般資訊已儲存。');
    } catch (e) {
      alert(e.message || '一般資訊儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveLine = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/line-account`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineForm),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'LINE OA 儲存失敗');
      clearApiCache(`/api/system/workspaces/${workspace.id}`);
      await load();
      alert('LINE OA 設定已儲存。');
    } catch (e) {
      alert(e.message || 'LINE OA 儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveTarget = async (target) => {
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/targets/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: target.name,
          endpointUrl: target.endpoint_url,
          enabled: Boolean(target.enabled),
          canReply: Boolean(target.can_reply),
          forwardSignature: Boolean(target.forward_signature),
          timeoutMs: target.timeout_ms,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Webhook 儲存失敗');
      clearApiCache(`/api/system/workspaces/${workspace.id}`);
    } catch (e) {
      alert(e.message || 'Webhook 儲存失敗');
    }
  };

  const patchTargetLocal = (targetIdValue, patch) => {
    setData(prev => ({
      ...prev,
      targets: (prev.targets || []).map(t => t.id === targetIdValue ? { ...t, ...patch } : t),
    }));
  };

  const checkConflict = async () => {
    if (!keyword.trim()) {
      setConflict(null);
      return;
    }
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/keywords/check-conflict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), matchType }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '衝突檢查失敗');
      setConflict(json.conflict || null);
    } catch (e) {
      alert(e.message || '衝突檢查失敗');
    }
  };

  const addKeyword = async () => {
    if (!keyword.trim()) return alert('請輸入關鍵字。');
    if (!targetId) return alert('請選擇 System A 或 B。');

    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword.trim(),
          matchType,
          targetId,
          priority: 100,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (json.conflict) setConflict(json.conflict);
        throw new Error(json.error || '關鍵字建立失敗');
      }
      setKeyword('');
      setConflict(null);
      await load();
    } catch (e) {
      alert(e.message || '關鍵字建立失敗');
    }
  };

  const removeKeyword = async (route) => {
    if (!confirm(`確定刪除「${route.keyword}」？`)) return;
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/keywords/${route.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '刪除失敗');
      await load();
    } catch (e) {
      alert(e.message || '刪除失敗');
    }
  };


  const runSimulator = async () => {
    if (!simMessage.trim()) return alert('請輸入測試訊息。');
    setSimRunning(true);
    setSimResult(null);
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/line-simulator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: simMessage.trim(), mode: simMode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '模擬失敗');
      setSimResult(json);
    } catch (e) {
      alert(e.message || '模擬失敗');
    } finally {
      setSimRunning(false);
    }
  };


  const loadMigrationPreview = async (sourceId = migrationSource) => {
    setMigrationLoading(true);
    try {
      const query = sourceId ? `?source=${encodeURIComponent(sourceId)}` : '';
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/data-migration-preview${query}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '資料移轉預覽失敗');

      setMigrationPreview(json);
      setMigrationSource(json.sourceWorkspaceId || '');
      setMigrationOptions(prev => ({ ...prev, templateIds: [], projectIds: [] }));
    } catch (e) {
      alert(e.message || '資料移轉預覽失敗');
    } finally {
      setMigrationLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'migration' && !migrationPreview) {
      loadMigrationPreview('');
    }
  }, [tab, workspace.id]);

  const toggleMigrationId = (key, value) => {
    setMigrationOptions(prev => {
      const current = new Set(prev[key] || []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [key]: Array.from(current) };
    });
  };

  const runMigration = async () => {
    if (!migrationSource) return alert('請選擇來源 Workspace。');

    const sourceName = migrationPreview?.source?.name || migrationSource;
    const targetName = profile.companyName || profile.workspaceName || workspace.name;
    const selectedContent =
      migrationOptions.templateIds.length + migrationOptions.projectIds.length;

    if (!confirm(
      `確認從「${sourceName}」安全複製到「${targetName}」？\n\n` +
      `LINE OA：${migrationOptions.copyLine ? '是' : '否'}\n` +
      `雙 Webhook：${migrationOptions.copyWebhooks ? '是' : '否'}\n` +
      `關鍵字：${migrationOptions.copyKeywords ? '是' : '否'}\n` +
      `模板 / 專案：${selectedContent} 筆\n\n` +
      `來源資料不會刪除；新的 Gateway Webhook URL 會保留。`
    )) return;

    setMigrationRunning(true);
    try {
      const res = await authFetch(`/api/system/workspaces/${workspace.id}/data-migration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceWorkspaceId: migrationSource,
          ...migrationOptions,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '資料移轉失敗');

      clearApiCache(`/api/system/workspaces/${workspace.id}`);
      clearApiCache('/api/system/templates');
      await load();

      const m = json.migration || {};
      alert(
        `資料歸戶完成。\n` +
        `LINE OA：${m.lineCopied ? '已複製' : '未複製'}\n` +
        `Webhook：${m.webhookTargetsCopied || 0} 組\n` +
        `關鍵字：${m.keywordRoutesCopied || 0} 筆\n` +
        `模板：${m.templatesCopied || 0} 套\n` +
        `專案：${m.projectsCopied || 0} 個\n` +
        `Assets：${m.assetsCopied || 0} 個\n` +
        `R2 Objects：${m.r2ObjectsCopied || 0} 個`
      );
    } catch (e) {
      alert(e.message || '資料移轉失敗');
    } finally {
      setMigrationRunning(false);
    }
  };

  if (loading || !data) {
    return <div className="p-10 text-center text-gray-500">載入帳號中...</div>;
  }

  const webhookUrl = data.lineAccount?.webhookPath
    ? `${PRODUCTION_WORKER_BASE_URL}${data.lineAccount.webhookPath}`
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="text-xs text-gray-500">客戶帳號 / {workspace.id}</div>
          <h2 className="text-2xl font-bold text-gray-900">
            {profile.companyName || profile.workspaceName}
          </h2>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {[
          ['profile', '一般資訊'],
          ['line', 'LINE OA 系統資訊'],
          ['webhook', '雙 Webhook / 關鍵字'],
          ['simulator', '模擬聊天室'],
          ['migration', 'Tenant Transfer'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${
              tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['Workspace / 品牌名稱', 'workspaceName'],
              ['聯絡人姓名', 'contactName'],
              ['電話', 'phone'],
              ['公司名稱', 'companyName'],
              ['統編', 'taxId'],
              ['產業', 'industry'],
              ['地址', 'address'],
              ['備註', 'notes'],
            ].map(([label, key]) => (
              <div key={key} className={key === 'notes' ? 'md:col-span-2' : ''}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input
                  value={profile[key] || ''}
                  onChange={e => setProfile(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={saveProfile} disabled={saving} className="bg-black text-white px-4 py-2 rounded-md text-sm">
              儲存一般資訊
            </button>
          </div>
        </div>
      )}

      {tab === 'line' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['LINE OA 名稱', 'oaName'],
              ['LINE Bot @帳號', 'lineBotBasicId'],
              ['LINE Login Channel ID', 'lineLoginChannelId'],
              ['LINE Bot Channel ID', 'lineBotChannelId'],
            ].map(([label, key]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input
                  type="text"
                  value={lineForm[key] || ''}
                  onChange={e => setLineForm(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            ))}

            {[
              ['LINE Login Channel Secret', 'lineLoginChannelSecret', 'hasLoginSecret'],
              ['LINE Bot Channel Access Token', 'lineBotChannelAccessToken', 'hasBotToken'],
              ['LINE Bot Channel Secret', 'lineBotChannelSecret', 'hasBotSecret'],
            ].map(([label, key, statusKey]) => {
              const configured = Boolean(data?.lineAccount?.[statusKey]);
              return (
                <div key={key}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <label className="block text-sm font-medium text-gray-700">{label}</label>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      configured
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {configured ? '● 已設定' : '○ 尚未設定'}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={lineForm[key] || ''}
                    onChange={e => setLineForm(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={configured ? '已安全保存；留白代表不變' : '請輸入設定值'}
                    autoComplete="new-password"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {configured
                      ? '基於安全性不回顯原值；只有輸入新值並儲存時才會覆蓋。'
                      : '尚未保存設定值。'}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LINE Gateway Webhook</label>
            <div className="flex gap-2">
              <input readOnly value={webhookUrl || '尚未產生'} className="flex-1 bg-gray-50 border border-gray-300 rounded-md px-3 py-2 text-xs font-mono" />
              <button onClick={() => webhookUrl && navigator.clipboard?.writeText(webhookUrl)} className="border px-4 py-2 rounded-md text-sm">
                複製
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={saveLine} disabled={saving} className="bg-black text-white px-4 py-2 rounded-md text-sm">
              儲存 LINE OA
            </button>
          </div>
        </div>
      )}

      {tab === 'webhook' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {(data.targets || []).map(target => (
              <div key={target.id} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">
                    {target.position === 1 ? 'System A' : 'System B'}
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${target.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {target.enabled ? '啟用' : '停用'}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">系統名稱</label>
                  <input
                    value={target.name || ''}
                    onChange={e => patchTargetLocal(target.id, { name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                  <input
                    value={target.endpoint_url || ''}
                    onChange={e => patchTargetLocal(target.id, { endpoint_url: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    placeholder="https://..."
                  />
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(target.enabled)}
                      onChange={e => patchTargetLocal(target.id, { enabled: e.target.checked ? 1 : 0 })}
                    />
                    啟用
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(target.can_reply)}
                      onChange={e => patchTargetLocal(target.id, { can_reply: e.target.checked ? 1 : 0 })}
                    />
                    可提出回覆
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(target.forward_signature)}
                      onChange={e => patchTargetLocal(target.id, { forward_signature: e.target.checked ? 1 : 0 })}
                    />
                    轉發 Signature
                  </label>
                </div>

                <button
                  onClick={() => saveTarget(target)}
                  className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm"
                >
                  儲存 {target.position === 1 ? 'System A' : 'System B'}
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="font-bold text-gray-900">中央關鍵字 Registry</h3>
              <p className="text-xs text-gray-500 mt-1">
                同一個 Workspace 的 System A / B 不允許競爭相同或重疊規則。
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                value={keyword}
                onChange={e => { setKeyword(e.target.value); setConflict(null); }}
                onBlur={checkConflict}
                placeholder="例如：預約"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <select value={matchType} onChange={e => { setMatchType(e.target.value); setConflict(null); }} className="border rounded-md px-3 py-2 text-sm">
                <option value="exact">完全符合</option>
                <option value="prefix">開頭符合</option>
                <option value="contains">包含</option>
              </select>
              <select value={targetId} onChange={e => setTargetId(e.target.value)} className="border rounded-md px-3 py-2 text-sm">
                {(data.targets || []).map(t => (
                  <option key={t.id} value={t.id}>{t.position === 1 ? 'System A' : 'System B'} · {t.name}</option>
                ))}
              </select>
              <button onClick={addKeyword} disabled={Boolean(conflict)} className="bg-black text-white rounded-md px-4 py-2 text-sm disabled:opacity-40">
                新增關鍵字
              </button>
            </div>

            {conflict && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                衝突：{conflict.targetName} 已使用「{conflict.keyword}」({conflict.matchType})。
              </div>
            )}

            <div className="divide-y border rounded-lg">
              {(data.keywordRoutes || []).length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">尚未建立關鍵字。</div>
              ) : (
                data.keywordRoutes.map(route => (
                  <div key={route.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{route.keyword}</div>
                      <div className="text-xs text-gray-500">{route.match_type} → {route.target_name}</div>
                    </div>
                    <button onClick={() => removeKeyword(route)} className="text-red-600 text-sm">
                      刪除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'migration' && (
        <div className="space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <div className="font-bold text-amber-900">安全資料歸戶</div>
            <p className="text-sm text-amber-800 mt-1">
              Tenant Transfer 2.6 採完整 SaaS 複製：Template / Areas / Project / Areas / Asset / R2 一起處理。
              來源資料保留，目的端建立新 ID 與新的 R2 路徑；Gateway Webhook URL 保留目的 Workspace 自己的網址。
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">來源 Workspace</label>
              <select
                value={migrationSource}
                onChange={e => {
                  setMigrationSource(e.target.value);
                  loadMigrationPreview(e.target.value);
                }}
                className="w-full md:w-96 border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">選擇來源 Workspace</option>
                {(migrationPreview?.sources || []).map(source => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.id}
                  </option>
                ))}
              </select>
            </div>

            {migrationLoading && <div className="text-sm text-gray-500">正在分析來源資料...</div>}

            {!migrationLoading && migrationPreview?.ownershipWarnings?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="font-bold text-red-900">Preflight 未通過</div>
                <div className="text-sm text-red-700 mt-1">
                  來源 Workspace 有 Asset ownership mismatch。請先到「租戶健康檢查」修復，再執行 Tenant Transfer。
                </div>
                <div className="mt-2 text-xs text-red-600">
                  {migrationPreview.ownershipWarnings.length} 個問題
                </div>
              </div>
            )}

            {!migrationLoading && migrationPreview?.source && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {[
                    ['LINE OA', migrationPreview.lineAccount ? '有設定' : '無資料'],
                    ['Webhook', `${migrationPreview.webhookTargets?.length || 0} 組`],
                    ['關鍵字', `${migrationPreview.keywordRoutes?.length || 0} 筆`],
                    ['模板', `${migrationPreview.templates?.length || 0} 套`],
                    ['專案', `${migrationPreview.projects?.length || 0} 個`],
                  ].map(([label, value]) => (
                    <div key={label} className="border border-gray-200 rounded-lg p-4">
                      <div className="text-xs text-gray-500">{label}</div>
                      <div className="font-bold text-gray-900 mt-1">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="font-bold text-gray-900">LINE / 路由設定</div>
                  {[
                    ['copyLine', 'LINE OA 系統資料（Channel ID / Secret / Access Token）'],
                    ['copyWebhooks', 'System A / System B URL 與設定'],
                    ['copyKeywords', '關鍵字 Registry（會取代目的 Workspace 現有關鍵字）'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(migrationOptions[key])}
                        onChange={e => setMigrationOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-gray-900">圖文選單模板</div>
                      <div className="text-xs text-gray-500 mt-1">
                        請只勾選屬於中騰保全的模板，避免把 Default Workspace 的測試資料一起複製。
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setMigrationOptions(prev => ({
                          ...prev,
                          templateIds: (migrationPreview.templates || []).map(x => x.id),
                        }))}
                        className="text-xs text-blue-600"
                      >全選</button>
                      <button
                        onClick={() => setMigrationOptions(prev => ({ ...prev, templateIds: [] }))}
                        className="text-xs text-gray-500"
                      >清除</button>
                    </div>
                  </div>

                  <div className="mt-3 divide-y divide-gray-100">
                    {(migrationPreview.templates || []).map(item => (
                      <label key={item.id} className="flex items-center gap-3 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={migrationOptions.templateIds.includes(item.id)}
                          onChange={() => toggleMigrationId('templateIds', item.id)}
                        />
                        <div>
                          <div className="font-medium text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-500">
                            {item.industry || '未分類'} · {item.area_count || 0} 熱區 · {item.status || '—'}
                          </div>
                        </div>
                      </label>
                    ))}
                    {(migrationPreview.templates || []).length === 0 && (
                      <div className="py-4 text-sm text-gray-500">來源沒有模板。</div>
                    )}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-gray-900">圖文選單專案</div>
                      <div className="text-xs text-gray-500 mt-1">
                        專案會建立新的 ID；圖片建立目的 Workspace 的 Asset 參照。
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setMigrationOptions(prev => ({
                          ...prev,
                          projectIds: (migrationPreview.projects || []).map(x => x.id),
                        }))}
                        className="text-xs text-blue-600"
                      >全選</button>
                      <button
                        onClick={() => setMigrationOptions(prev => ({ ...prev, projectIds: [] }))}
                        className="text-xs text-gray-500"
                      >清除</button>
                    </div>
                  </div>

                  <div className="mt-3 divide-y divide-gray-100">
                    {(migrationPreview.projects || []).map(item => (
                      <label key={item.id} className="flex items-center gap-3 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={migrationOptions.projectIds.includes(item.id)}
                          onChange={() => toggleMigrationId('projectIds', item.id)}
                        />
                        <div>
                          <div className="font-medium text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-500">
                            {item.area_count || 0} 熱區 · {item.status || '—'}
                          </div>
                        </div>
                      </label>
                    ))}
                    {(migrationPreview.projects || []).length === 0 && (
                      <div className="py-4 text-sm text-gray-500">來源沒有專案。</div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={runMigration}
                    disabled={migrationRunning || !migrationSource || migrationPreview?.preflightHealthy === false}
                    className="bg-black hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-md text-sm font-bold"
                  >
                    {migrationRunning ? 'Tenant Transfer 執行中...' : '開始 Tenant Transfer'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'simulator' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="border rounded-3xl overflow-hidden bg-[#8cabd0] shadow-sm">
            <div className="bg-[#06c755] text-white p-4">
              <div className="font-bold">{profile.companyName || profile.workspaceName || 'LINE OA'}</div>
              <div className="text-xs opacity-90">Sandbox · 不會送到真正 LINE 聊天室</div>
            </div>
            <div className="min-h-[380px] p-4 space-y-4">
              <div className="flex justify-end">
                <div className="bg-[#9de56f] rounded-2xl rounded-br-sm px-4 py-2 text-sm max-w-[80%]">
                  {simMessage || '輸入測試訊息，例如：我要預約'}
                </div>
              </div>
              {simResult && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 text-sm max-w-[85%]">
                    <div className="font-medium">模擬路由完成</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {simResult.routing?.target?.system || '沒有 Target'}
                      {simResult.routing?.keyword ? ` · ${simResult.routing.keyword}` : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="bg-white p-3 flex gap-2">
              <input
                value={simMessage}
                onChange={e => setSimMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runSimulator();
                  }
                }}
                placeholder="輸入測試訊息..."
                className="flex-1 border rounded-full px-4 py-2 text-sm"
              />
              <button
                onClick={runSimulator}
                disabled={simRunning}
                className="bg-[#06c755] text-white rounded-full px-5 py-2 text-sm disabled:opacity-50"
              >
                {simRunning ? '測試中' : '傳送'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white border rounded-xl p-5">
              <h3 className="font-bold">測試模式</h3>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setSimMode('routing')} className={`px-4 py-2 rounded-md text-sm border ${simMode === 'routing' ? 'bg-blue-50 border-blue-500' : ''}`}>純模擬</button>
                <button onClick={() => setSimMode('webhook')} className={`px-4 py-2 rounded-md text-sm border ${simMode === 'webhook' ? 'bg-amber-50 border-amber-500' : ''}`}>Webhook 測試</button>
              </div>
              <p className="text-xs text-gray-500 mt-3">純模擬不呼叫下游；Webhook 測試帶 dry-run 標記，而且不呼叫 LINE Reply API。</p>
            </div>
            <div className="bg-white border rounded-xl p-5">
              <h3 className="font-bold">Routing Inspector</h3>
              {!simResult ? (
                <p className="text-sm text-gray-500 mt-3">傳送測試訊息後顯示路由結果。</p>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  <div>關鍵字：<b>{simResult.routing?.keyword || '未命中'}</b></div>
                  <div>規則：<b>{simResult.routing?.matchType || '-'}</b></div>
                  <div>路由：<b>{simResult.routing?.target?.system || '無'}</b> {simResult.routing?.target?.name || ''}</div>
                  <div>衝突：<b>{simResult.routing?.conflictDetected ? '有' : '無'}</b></div>
                  <div>耗時：<b>{simResult.elapsedMs} ms</b></div>
                  {simResult.downstream && <div>Webhook：<b>{simResult.downstream.ok ? `HTTP ${simResult.downstream.status}` : simResult.downstream.reason}</b></div>}
                  <div>LINE Reply：<b>Simulation Only</b></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};


const MembersView = ({ onOpenAccount }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    password: '',
    email: '',
    role: 'editor',
  });

  const loadMembers = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/members');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '成員查詢失敗');
      setMembers(data.members || []);
    } catch (e) {
      console.error(e);
      alert('成員讀取失敗：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const addMember = async () => {
    if (!form.username.trim() && !form.email.trim()) {
      return alert('至少填寫帳號或 Email。');
    }
    if (form.password.length < 8) {
      return alert('初始密碼至少需要 8 個字元。');
    }

    setSaving(true);
    try {
      const res = await authFetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          username: form.username.trim(),
          password: form.password,
          email: form.email.trim(),
          role: form.role,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '新增成員失敗');

      setForm({
        displayName: '',
        username: '',
        password: '',
        email: '',
        role: 'editor',
      });
      setFormOpen(false);
      await loadMembers();
    } catch (e) {
      console.error(e);
      alert('新增成員失敗：' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateMember = async (member, patch) => {
    if (member.role === 'owner') return;

    const nextRole = patch.role ?? member.role;
    const nextStatus = patch.status ?? member.status;

    try {
      const res = await authFetch(`/api/members/${member.membership_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: nextRole,
          status: nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '成員更新失敗');

      setMembers(prev =>
        prev.map(item =>
          item.membership_id === member.membership_id
            ? { ...item, role: nextRole, status: nextStatus }
            : item
        )
      );
    } catch (e) {
      console.error(e);
      alert('成員更新失敗：' + e.message);
    }
  };

  const deleteMember = async (member) => {
    if (member.role === 'owner') {
      return alert('Owner 不可移除。');
    }

    if (!confirm(`確定要移除「${member.display_name || member.email || '此成員'}」嗎？`)) {
      return;
    }

    try {
      const res = await authFetch(`/api/members/${member.membership_id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '移除成員失敗');

      setMembers(prev =>
        prev.filter(item => item.membership_id !== member.membership_id)
      );
    } catch (e) {
      console.error(e);
      alert('移除成員失敗：' + e.message);
    }
  };

  const roleLabel = (role) => {
    if (role === 'owner') return '擁有者';
    if (role === 'admin') return '管理員';
    if (role === 'editor') return '編輯者';
    return '檢視者';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">團隊成員</h2>
          <p className="text-sm text-gray-500 mt-1">
            管理這個 Workspace 的使用者與權限。成員只會存取自己所屬 Workspace 的資料。
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} />
          新增成員
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          ['擁有者', members.filter(m => m.role === 'owner' && m.status === 'active').length],
          ['管理員', members.filter(m => m.role === 'admin' && m.status === 'active').length],
          ['編輯者', members.filter(m => m.role === 'editor' && m.status === 'active').length],
          ['檢視者', members.filter(m => m.role === 'viewer' && m.status === 'active').length],
        ].map(([label, value]) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">Workspace 成員</h3>
            <p className="text-xs text-gray-500 mt-1">Owner 不可由一般成員管理 API 降權或刪除。</p>
          </div>
          <button onClick={loadMembers} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            重新整理
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center items-center gap-2 text-gray-500">
            <Loader2 size={18} className="animate-spin" />
            載入成員中...
          </div>
        ) : members.length === 0 ? (
          <div className="py-16 text-center text-gray-500">目前沒有成員資料。</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map(member => {
              const isOwner = member.role === 'owner';
              const disabled = member.status !== 'active';

              return (
                <div key={member.membership_id} className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900">
                        {member.display_name || '未命名使用者'}
                      </div>
                      {isOwner && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
                          Owner
                        </span>
                      )}
                      {disabled && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          已停用
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 space-x-2">
                      {member.email && <span>{member.email}</span>}
                      {member.line_user_id && <span>LINE UID：{member.line_user_id}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={member.role}
                      disabled={isOwner}
                      onChange={(e) => updateMember(member, { role: e.target.value })}
                      className="border border-gray-300 rounded-md py-2 px-3 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      {isOwner && <option value="owner">擁有者</option>}
                      <option value="admin">管理員</option>
                      <option value="editor">編輯者</option>
                      <option value="viewer">檢視者</option>
                    </select>

                    {!isOwner && (
                      <button
                        onClick={() => updateMember(member, { status: disabled ? 'active' : 'disabled' })}
                        className="border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-md text-sm font-medium text-gray-700"
                      >
                        {disabled ? '啟用' : '停用'}
                      </button>
                    )}

                    <button
                      onClick={() => onOpenAccount?.(member)}
                      className="border border-blue-200 hover:bg-blue-50 text-blue-600 px-3 py-2 rounded-md text-sm font-medium"
                    >
                      進入帳號
                    </button>

                    {!isOwner && (
                      <button
                        onClick={() => deleteMember(member)}
                        className="border border-red-200 hover:bg-red-50 text-red-600 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        移除
                      </button>
                    )}

                    <span className="text-xs text-gray-400 min-w-[56px] text-right">
                      {roleLabel(member.role)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200">
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="font-bold text-gray-900">新增 Workspace 成員</div>
                <div className="text-xs text-gray-500 mt-1">先建立帳號與初始密碼；LINE UID 後續由綁定流程取得。</div>
              </div>
              <button onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">顯示名稱</label>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm(prev => ({ ...prev, displayName: e.target.value }))}
                  placeholder="例如：王小明"
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">登入帳號</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="例如：tony01"
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">可使用帳號或 Email 登入。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">初始密碼</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="至少 8 個字元"
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">首次登入後可再修改密碼。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="name@example.com"
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
                LINE UID 尚未綁定。使用者日後完成 LINE 登入／綁定後，系統會自動寫入 UID。
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="editor">編輯者</option>
                  <option value="viewer">檢視者</option>
                  <option value="admin">管理員</option>
                </select>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setFormOpen(false)}
                className="border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-md text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={addMember}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                新增成員
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};





const TenantIntegrityView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      clearApiCache('/api/system/tenant-integrity');
      const json = await cachedAuthJson('/api/system/tenant-integrity', 3000);
      setData(json);
    } catch (e) {
      setError(e.message || '租戶健康檢查失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="p-10 text-sm text-gray-500">正在檢查 SaaS Tenant Integrity...</div>;
  }

  if (error) {
    return <div className="p-10 text-sm text-red-600">{error}</div>;
  }

  if (!data) return null;

  const issues = (data.issues || []).filter(issue => {
    if (
      workspaceFilter !== 'all' &&
      issue.expected_workspace_id !== workspaceFilter &&
      issue.actual_workspace_id !== workspaceFilter
    ) {
      return false;
    }

    if (severityFilter !== 'all' && issue.severity !== severityFilter) {
      return false;
    }

    return true;
  });

  const summary = data.summary || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">租戶健康檢查</h2>
          <p className="text-sm text-gray-500 mt-1">
            檢查 SaaS ownership 是否一致。此頁完全只讀，不會自動修復資料。
          </p>
        </div>

        <button
          onClick={load}
          className="border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-md text-sm font-medium"
        >
          重新檢查
        </button>
      </div>

      <div className={`border rounded-xl p-5 ${
        summary.healthy
          ? 'bg-green-50 border-green-200'
          : summary.criticalIssues > 0
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
      }`}>
        <div className={`font-bold ${
          summary.healthy
            ? 'text-green-900'
            : summary.criticalIssues > 0
              ? 'text-red-900'
              : 'text-amber-900'
        }`}>
          {summary.healthy
            ? 'SaaS Tenant Integrity 正常'
            : `發現 ${summary.totalIssues || 0} 個 ownership / 關聯問題`}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div className="bg-white/80 border rounded-lg p-4">
            <div className="text-xs text-gray-500">Critical</div>
            <div className="text-2xl font-bold text-red-700 mt-1">
              {summary.criticalIssues || 0}
            </div>
          </div>

          <div className="bg-white/80 border rounded-lg p-4">
            <div className="text-xs text-gray-500">Warning</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">
              {summary.warningIssues || 0}
            </div>
          </div>

          <div className="bg-white/80 border rounded-lg p-4">
            <div className="text-xs text-gray-500">Total</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {summary.totalIssues || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="font-bold text-gray-900">Workspace 健康摘要</div>
          <div className="text-xs text-gray-500 mt-1">
            Templates / Projects / Assets / Members / LINE / Webhook / Keyword 資料量。
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {[
                  'Workspace',
                  'Templates',
                  'Template Areas',
                  'Projects',
                  'Project Areas',
                  'Assets',
                  'Members',
                  'LINE',
                  'Webhooks',
                  'Keywords',
                  'Issues',
                ].map(label => (
                  <th key={label} className="text-left px-4 py-3 font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {(data.workspaces || []).map(w => {
                const issueCount = data.workspaceIssueCounts?.[w.id] || {
                  critical: 0,
                  warning: 0,
                  total: 0,
                };

                return (
                  <tr key={w.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{w.name}</div>
                      <div className="text-xs text-gray-400">{w.id}</div>
                    </td>
                    <td className="px-4 py-3">{w.template_count}</td>
                    <td className="px-4 py-3">{w.template_area_count}</td>
                    <td className="px-4 py-3">{w.project_count}</td>
                    <td className="px-4 py-3">{w.project_area_count}</td>
                    <td className="px-4 py-3">{w.asset_count}</td>
                    <td className="px-4 py-3">{w.member_count}</td>
                    <td className="px-4 py-3">{Number(w.has_line_account) ? '✓' : '—'}</td>
                    <td className="px-4 py-3">{w.webhook_count}</td>
                    <td className="px-4 py-3">{w.keyword_count}</td>
                    <td className="px-4 py-3">
                      {issueCount.total === 0 ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                          正常
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
                          {issueCount.total} 個
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={workspaceFilter}
          onChange={e => setWorkspaceFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">全部 Workspace</option>
          {(data.workspaces || []).map(w => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.id}
            </option>
          ))}
        </select>

        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">全部嚴重度</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="font-bold text-gray-900">Integrity Issues</div>
            <div className="text-xs text-gray-500 mt-1">
              發現問題只標示，不會自動改資料。
            </div>
          </div>
          <div className="text-xs text-gray-500">{issues.length} 筆</div>
        </div>

        {issues.length === 0 ? (
          <div className="p-10 text-center text-sm text-green-700">
            目前篩選條件下沒有 ownership 異常。
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {issues.map((issue, index) => (
              <div
                key={`${issue.issue_type}-${issue.parent_id}-${issue.child_id}-${index}`}
                className="p-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    issue.severity === 'critical'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {issue.severity}
                  </span>
                  <span className="font-semibold text-gray-900">{issue.issue_type}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Parent</div>
                    <div className="font-medium mt-1">{issue.parent_name || '—'}</div>
                    <div className="text-xs text-gray-400 break-all">{issue.parent_id || '—'}</div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500">Child / Relation</div>
                    <div className="font-medium mt-1">{issue.child_name || issue.relation_name || '—'}</div>
                    <div className="text-xs text-gray-400 break-all">
                      {issue.child_id || issue.relation_name || '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-xs font-mono bg-gray-50 rounded-lg p-3">
                  expected workspace: {issue.expected_workspace_id || '—'}
                  <br />
                  actual workspace: {issue.actual_workspace_id || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};


const TenantInventoryView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [section, setSection] = useState('templates');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      clearApiCache('/api/system/tenant-inventory');
      const json = await cachedAuthJson('/api/system/tenant-inventory', 5000);
      setData(json);
    } catch (e) {
      setError(e.message || '租戶資料盤點失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-10 text-sm text-gray-500">正在盤點 SaaS 租戶資料...</div>;
  if (error) return <div className="p-10 text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const filterRows = (rows = []) =>
    workspaceFilter === 'all'
      ? rows
      : rows.filter(x => x.workspace_id === workspaceFilter);

  const defaultWorkspace = data.workspaces?.find(x => x.id === 'default');

  const sectionRows = {
    templates: filterRows(data.templates),
    projects: filterRows(data.projects),
    assets: filterRows(data.assets),
    members: filterRows(data.members),
    line: filterRows(data.lineAccounts),
    webhooks: filterRows(data.webhookTargets),
    keywords: filterRows(data.keywordRoutes),
  }[section] || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">租戶資料盤點</h2>
          <p className="text-sm text-gray-500 mt-1">
            直接查看每筆資料真正的 workspace_id。這一頁只讀，不會修改或搬移資料。
          </p>
        </div>
        <button onClick={load} className="border border-gray-300 bg-white px-4 py-2 rounded-md text-sm">
          重新盤點
        </button>
      </div>

      {defaultWorkspace && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="font-bold text-amber-900">Default Workspace 目前仍有的資料</div>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mt-3 text-sm">
            {[
              ['成員', defaultWorkspace.member_count],
              ['模板', defaultWorkspace.template_count],
              ['專案', defaultWorkspace.project_count],
              ['Assets', defaultWorkspace.asset_count],
              ['LINE', defaultWorkspace.has_line_account ? 1 : 0],
              ['Webhook', defaultWorkspace.webhook_count],
              ['關鍵字', defaultWorkspace.keyword_count],
            ].map(([label, value]) => (
              <div key={label} className="bg-white/70 rounded-lg p-3 border border-amber-100">
                <div className="text-xs text-amber-700">{label}</div>
                <div className="font-bold text-amber-950 mt-1">{value ?? 0}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 font-bold text-gray-900">Workspace 總覽</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['Workspace','Members','Templates','Projects','Assets','LINE','Webhooks','Keywords'].map(x => (
                  <th key={x} className="text-left px-4 py-3 font-medium">{x}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data.workspaces || []).map(w => (
                <tr key={w.id} className={w.id === 'default' ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{w.name}</div>
                    <div className="text-xs text-gray-400">{w.id}</div>
                  </td>
                  <td className="px-4 py-3">{w.member_count}</td>
                  <td className="px-4 py-3">{w.template_count}</td>
                  <td className="px-4 py-3">{w.project_count}</td>
                  <td className="px-4 py-3">{w.asset_count}</td>
                  <td className="px-4 py-3">{Number(w.has_line_account) ? '有' : '—'}</td>
                  <td className="px-4 py-3">{w.webhook_count}</td>
                  <td className="px-4 py-3">{w.keyword_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={workspaceFilter}
          onChange={e => setWorkspaceFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">全部 Workspace</option>
          {(data.workspaces || []).map(w => (
            <option key={w.id} value={w.id}>{w.name} · {w.id}</option>
          ))}
        </select>

        {[
          ['templates','Templates'],
          ['projects','Projects'],
          ['assets','Assets'],
          ['members','Members'],
          ['line','LINE'],
          ['webhooks','Webhooks'],
          ['keywords','Keywords'],
        ].map(([id,label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`px-3 py-2 rounded-md text-sm ${
              section === id ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between">
          <div className="font-bold text-gray-900">{section.toUpperCase()} 明細</div>
          <div className="text-xs text-gray-500">{sectionRows.length} 筆</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Workspace</th>
                <th className="text-left px-4 py-3">ID / 名稱</th>
                <th className="text-left px-4 py-3">資訊</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sectionRows.map((row, index) => (
                <tr key={row.id || `${row.workspace_id}-${index}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">{row.workspace_name || row.workspace_id}</div>
                    <div className="text-xs text-gray-400">{row.workspace_id}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">
                      {row.name || row.display_name || row.oa_name || row.keyword || row.original_filename || row.id || '—'}
                    </div>
                    <div className="text-xs text-gray-400 break-all">{row.id || row.user_id || '—'}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-gray-600 max-w-xl break-all">
                    {section === 'templates' && `${row.industry || '未分類'} · ${row.area_count || 0} 熱區 · asset=${row.asset_id || '—'}`}
                    {section === 'projects' && `${row.status || '—'} · ${row.area_count || 0} 熱區 · template=${row.template_id || '—'} · asset=${row.asset_id || '—'}`}
                    {section === 'assets' && `${row.storage_key || '—'} · ${row.content_type || '—'} · ${row.size_bytes || 0} bytes`}
                    {section === 'members' && `${row.username || '—'} · ${row.email || '—'} · role=${row.role}`}
                    {section === 'line' && `${row.line_bot_basic_id || '—'} · Login=${row.line_login_channel_id || '—'} · Bot=${row.line_channel_id || '—'} · secrets=${Number(row.has_login_secret)}/${Number(row.has_bot_token)}/${Number(row.has_bot_secret)}`}
                    {section === 'webhooks' && `${row.target_type || '—'} · position=${row.position} · ${row.endpoint_url || 'URL 未設定'} · enabled=${row.enabled}`}
                    {section === 'keywords' && `${row.match_type} → ${row.target_name || '—'} · priority=${row.priority} · enabled=${row.enabled}`}
                  </td>
                </tr>
              ))}
              {sectionRows.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-4 py-8 text-center text-gray-500">沒有資料。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


const SystemTemplatesView = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadTemplates = async (force = false) => {
    setLoading(true);
    setError('');

    try {
      if (force) clearApiCache('/api/system/templates');
      const data = await cachedAuthJson('/api/system/templates', 10000);
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e.message || '全租戶模板讀取失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const workspaceOptions = Array.from(
    new Map(
      templates.map((t) => [
        t.workspaceId,
        { id: t.workspaceId, name: t.workspaceName || t.workspaceId },
      ])
    ).values()
  ).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'));

  const keyword = searchText.trim().toLowerCase();

  const filtered = templates.filter((t) => {
    if (workspaceFilter !== 'all' && t.workspaceId !== workspaceFilter) return false;
    if (statusFilter !== 'all' && String(t.status || '') !== statusFilter) return false;

    if (keyword) {
      const haystack = [
        t.name,
        t.workspaceName,
        t.workspaceId,
        t.industry,
        t.status,
      ].map((v) => String(v || '').toLowerCase()).join(' ');

      if (!haystack.includes(keyword)) return false;
    }

    return true;
  });

  const openDetail = async (template) => {
    setDetailLoading(true);

    try {
      const data = await cachedAuthJson(`/api/system/templates/${template.id}`, 5000);
      setSelectedTemplate(data.template || template);
    } catch (e) {
      alert(e.message || '模板詳情讀取失敗');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">圖文選單模板</h2>
          <p className="text-gray-500 text-sm mt-1">
            系統管理端可跨 Workspace 查看所有租用戶模板；租用戶端仍只看自己的模板。
          </p>
        </div>
        <button
          onClick={() => loadTemplates(true)}
          className="border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md text-sm font-medium"
        >
          重新整理
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-gray-400" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜尋模板 / 客戶 / Workspace"
            className="w-full border border-gray-300 rounded-md py-2.5 pl-9 pr-3 text-sm"
          />
        </div>

        <select
          value={workspaceFilter}
          onChange={(e) => setWorkspaceFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2.5 px-3 text-sm bg-white"
        >
          <option value="all">全部客戶 / Workspace</option>
          {workspaceOptions.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2.5 px-3 text-sm bg-white"
        >
          <option value="all">全部狀態</option>
          <option value="draft">draft</option>
          <option value="verified">verified</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">全租戶模板中心</h3>
            <p className="text-xs text-gray-500 mt-1">
              共 {templates.length} 套；目前篩選顯示 {filtered.length} 套。
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
            System Admin
          </span>
        </div>

        {loading && <div className="p-8 text-sm text-gray-500">模板載入中...</div>}
        {!loading && error && <div className="p-8 text-sm text-red-600">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-gray-500">
            目前篩選條件下沒有模板。
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left font-medium px-5 py-3">模板</th>
                  <th className="text-left font-medium px-5 py-3">客戶 / Workspace</th>
                  <th className="text-left font-medium px-5 py-3">分類</th>
                  <th className="text-left font-medium px-5 py-3">狀態</th>
                  <th className="text-left font-medium px-5 py-3">熱區</th>
                  <th className="text-left font-medium px-5 py-3">AI</th>
                  <th className="text-left font-medium px-5 py-3">更新時間</th>
                  <th className="text-right font-medium px-5 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((template) => (
                  <tr key={template.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-[210px]">
                        <AuthImage
                          src={template.imageUrl}
                          alt={template.name}
                          className="w-16 h-11 rounded-md object-cover shrink-0"
                        />
                        <div>
                          <div className="font-semibold text-gray-900">{template.name}</div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{template.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800">
                        {template.workspaceName || template.workspaceId}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {template.workspaceId}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{template.industry || '—'}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                        {template.status || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{template.areaCount ?? 0}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {template.aiProvider || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                      {template.updatedAt || template.createdAt || '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => openDetail(template)}
                        disabled={detailLoading}
                        className="text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                      >
                        檢視
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTemplate && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">模板詳情</div>
              <h3 className="text-xl font-bold text-gray-900 mt-1">{selectedTemplate.name}</h3>
              <p className="text-sm text-gray-500 mt-1">
                所屬客戶：{selectedTemplate.workspaceName || selectedTemplate.workspaceId}
              </p>
            </div>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              關閉
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 mt-5">
            <AuthImage
              src={selectedTemplate.imageUrl}
              alt={selectedTemplate.name}
              className="w-full aspect-[2500/1686] rounded-lg object-cover border border-gray-200"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-500">Workspace</div>
                <div className="font-semibold mt-1 break-all">{selectedTemplate.workspaceId}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">狀態</div>
                <div className="font-semibold mt-1">{selectedTemplate.status || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">產業</div>
                <div className="font-semibold mt-1">{selectedTemplate.industry || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">熱區</div>
                <div className="font-semibold mt-1">{selectedTemplate.areaCount ?? 0}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">頁數</div>
                <div className="font-semibold mt-1">{selectedTemplate.pageCount ?? 1}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">AI</div>
                <div className="font-semibold mt-1">
                  {selectedTemplate.aiProvider || '—'} / {selectedTemplate.aiModel || '—'}
                </div>
              </div>
            </div>
          </div>

          {Array.isArray(selectedTemplate.areas) && (
            <div className="mt-6">
              <h4 className="font-bold text-gray-900">熱區設定</h4>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {selectedTemplate.areas.map((area, index) => (
                  <div key={area.id || index} className="border border-gray-200 rounded-lg p-3">
                    <div className="font-semibold text-sm">
                      {area.label || `區塊 ${index + 1}`}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {area.actionType || 'none'} · x:{area.x} y:{area.y} w:{area.width} h:{area.height}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


const TemplatesView = ({ onNavigate, onEditTemplate }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch('/api/templates');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '模板查詢失敗');
      setTemplates(data.templates || []);
    } catch (e) {
      console.error(e);
      setError(e.message || '模板查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const deleteTemplate = async (template) => {
    if (!confirm(`確定要刪除「${template.name}」嗎？`)) return;
    try {
      const res = await authFetch(`/api/templates/${template.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '刪除失敗');
      await loadTemplates();
    } catch (e) {
      alert(e.message || '刪除失敗');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">模板中心</h2>
          <p className="text-gray-500 text-sm mt-1">模板圖片存 R2，座標與 Action 存 D1；建立一次即可重複套用。</p>
        </div>
        <button
          onClick={onNavigate}
          className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          建立新模板
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">可重複使用模板</h3>
            <p className="text-xs text-gray-500 mt-1">直接從 D1 查詢；圖片由 R2 提供。</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">{templates.length} 套</span>
        </div>

        {loading && <div className="p-8 text-sm text-gray-500">模板載入中...</div>}
        {!loading && error && <div className="p-8 text-sm text-red-600">{error}</div>}
        {!loading && !error && templates.length === 0 && (
          <div className="p-10 text-center text-sm text-gray-500">目前沒有模板，請先建立第一套模板。</div>
        )}

        {!loading && !error && templates.length > 0 && (
          <div className="divide-y divide-gray-100">
            {templates.map((template) => (
              <div key={template.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-16 h-12 rounded-lg bg-indigo-50 overflow-hidden flex items-center justify-center shrink-0">
                    {template.imageUrl ? (
                      <AuthImage src={template.imageUrl} alt={template.name} className="w-full h-full object-cover" />
                    ) : (
                      <LayoutTemplate size={20} className="text-indigo-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 truncate">{template.name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {template.industry || '待分類'} · {template.areaCount ?? 0} 個熱區 · {template.pageCount ?? 1} 頁
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">ID: {template.id}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${template.status === 'verified' || template.status === '已驗證' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {template.status === 'verified' ? '已驗證' : (template.status || '草稿')}
                  </span>
                  <button
                    onClick={() => onEditTemplate(template.id)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    編輯模板
                  </button>
                  <button
                    onClick={() => deleteTemplate(template)}
                    className="text-sm font-medium text-red-600 hover:text-red-800"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const EditorView = ({ onBack, mode = 'project', templateId = null }) => {
  const [activeArea, setActiveArea] = useState(1);
  const [activeTab, setActiveTab] = useState('image');
  
  const [isUploading, setIsUploading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [areas, setAreas] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const [templateStatus, setTemplateStatus] = useState('draft');
  const [assetId, setAssetId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const fileInputRef = useRef(null);
  const isTemplateMode = mode === 'template';


  useEffect(() => {
    if (!isTemplateMode || !templateId) {
      if (isTemplateMode && !templateId) {
        setTemplateName('');
        setTemplateStatus('draft');
        setBgImage(null);
        setAreas([]);
        setAssetId(null);
        setSelectedFile(null);
      }
      return;
    }

    let cancelled = false;
    const loadTemplate = async () => {
      setIsLoadingTemplate(true);
      try {
        const res = await authFetch(`/api/templates/${templateId}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '模板讀取失敗');
        if (cancelled) return;
        const tpl = data.template;
        setTemplateName(tpl.name || '');
        setTemplateStatus(tpl.status || 'draft');
        setAssetId(tpl.assetId || null);

        if (tpl.imageUrl) {
          const imageRes = await authFetch(tpl.imageUrl);
          if (!imageRes.ok) {
            const imageError = await imageRes.json().catch(() => ({}));
            throw new Error(imageError.error || '模板圖片讀取失敗');
          }
          const imageBlob = await imageRes.blob();
          const objectUrl = URL.createObjectURL(imageBlob);
          setBgImage(objectUrl);
        } else {
          setBgImage(null);
        }

        setAreas(tpl.areas || []);
        setActiveArea(tpl.areas?.[0]?.id || 1);
        setActiveTab(tpl.areas?.length ? 'action' : 'image');
        setSelectedFile(null);
      } catch (e) {
        console.error(e);
        alert(e.message || '模板讀取失敗');
      } finally {
        if (!cancelled) setIsLoadingTemplate(false);
      }
    };
    loadTemplate();
    return () => { cancelled = true; };
  }, [isTemplateMode, templateId]);

  const ACTION_TYPES = [
    { value: 'uri', label: '開啟網頁 (URI)' },
    { value: 'message', label: '傳送文字 (Message)' },
    { value: 'postback', label: '觸發後端流程 (Postback)' },
    { value: 'richmenuswitch', label: '切換其他選單頁面 (Rich Menu Switch)' },
    { value: 'none', label: '停用 / 無動作' },
  ];

  const PAGES = [
    { id: 'page_home', label: '首頁' },
    { id: 'page_menu', label: '本週菜單' },
    { id: 'page_booking', label: '預約服務' },
    { id: 'page_member', label: '會員中心' },
  ];

  const suggestAction = (label = '') => {
    const text = String(label).trim();
    if (/返回|首頁/.test(text)) {
      return { type: 'richmenuswitch', targetPageId: 'page_home', data: 'switch=home' };
    }
    if (/客服|諮詢|聯絡/.test(text)) {
      return { type: 'message', text: '我要聯絡客服' };
    }
    if (/預約/.test(text)) {
      return { type: 'message', text: '我要預約' };
    }
    if (/菜單|最新|活動|有禮|兌換|註冊|調查|通知|查詢/.test(text)) {
      return { type: 'uri', uri: 'https://example.com/' };
    }
    return { type: 'uri', uri: 'https://example.com/' };
  };

  const fillTemplatePlaceholderAction = (area) => {
    const label = String(area?.label || '功能').trim() || '功能';
    const action = area?.action || suggestAction(label);

    if (action.type === 'uri') {
      return { ...area, action: { ...action, uri: String(action.uri || '').trim() || `https://example.com/?source=${encodeURIComponent(label)}` } };
    }
    if (action.type === 'message') {
      return { ...area, action: { ...action, text: String(action.text || '').trim() || `我要了解${label}` } };
    }
    if (action.type === 'postback') {
      return { ...area, action: { ...action, data: String(action.data || '').trim() || `action=template_demo&area=${encodeURIComponent(label)}`, displayText: String(action.displayText || '').trim() || label } };
    }
    if (action.type === 'richmenuswitch') {
      return { ...area, action: { ...action, targetPageId: String(action.targetPageId || '').trim() || 'page_home', data: String(action.data || '').trim() || 'switch=home' } };
    }
    return area;
  };

  const normalizeDetectedArea = (area) => ({
    ...area,
    action: area.action || suggestAction(area.label),
  });

  const updateAreaAction = (areaId, patch) => {
    setAreas(prev => prev.map(area => (
      area.id === areaId
        ? { ...area, action: { ...(area.action || suggestAction(area.label)), ...patch } }
        : area
    )));
  };

  const setAreaActionType = (areaId, type) => {
    const defaults = {
      uri: { type: 'uri', uri: '' },
      message: { type: 'message', text: '' },
      postback: { type: 'postback', data: '', displayText: '' },
      richmenuswitch: { type: 'richmenuswitch', targetPageId: 'page_home', data: '' },
      none: { type: 'none' },
    };
    setAreas(prev => prev.map(area => (
      area.id === areaId
        ? { ...area, action: defaults[type] || { type: 'uri', uri: '' } }
        : area
    )));
  };

  const saveTemplate = async (targetStatus = 'verified') => {
    if (!isTemplateMode) return;
    if (!templateName.trim()) {
      alert('請先輸入模板名稱。');
      return;
    }
    if (!bgImage || areas.length === 0) {
      alert('請先上傳圖片並完成 AI 熱區偵測。');
      return;
    }

    // 建立「模板」時不要求填入客戶正式參數。
    // 空白 URI / Message / Postback / Switch 會先自動補測試參數，讓模板可以完成驗證與入庫。
    const preparedAreas = areas.map(fillTemplatePlaceholderAction);

    try {
      let finalAssetId = assetId;

      if (selectedFile) {
        const formData = new FormData();
        formData.append('image', selectedFile);
        const uploadRes = await authFetch('/api/templates/upload-image', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.success) throw new Error(uploadData.error || '圖片寫入 R2 失敗');
        finalAssetId = uploadData.asset.id;
        setAssetId(finalAssetId);
      }

      if (!finalAssetId) throw new Error('缺少模板圖片 Asset，請重新上傳圖片。');

      const payload = {
        name: templateName.trim(),
        industry: '待分類',
        status: targetStatus,
        assetId: finalAssetId,
        pageCount: 1,
        aiProvider: 'gemini',
        aiModel: 'gemini-3.6-flash',
        areas: preparedAreas.map(({ style, ...area }) => area),
      };

      const editing = Boolean(templateId);
      const res = await authFetch(editing ? `/api/templates/${templateId}` : '/api/templates', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '模板儲存失敗');

      setAreas(preparedAreas);
      setTemplateStatus(targetStatus);
      alert(targetStatus === 'verified' ? '模板已驗證並寫入 D1 / R2。尚未填寫的 Action 已自動使用測試參數，客戶套用時再替換正式內容。' : '模板草稿已寫入 D1 / R2。');
      onBack();
    } catch (e) {
      console.error(e);
      alert(e.message || '模板儲存失敗。');
    }
  };

  const handleUploadAndDetect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log('1. 檔案已選取:', file.name, file.size);
    const previewUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setBgImage(previewUrl);
    setIsUploading(true);
    setIsDetecting(true);

    try {
      const formData = new FormData();
      formData.append('image', file);

      console.log(`2. 準備發送 AI 偵測請求至 ${API_BASE_URL}/api/detect-layout ...`);
      const response = await authFetch('/api/detect-layout', {
        method: 'POST',
        body: formData,
      });

      console.log('3. 收到後端回應狀態:', response.status);
      const data = await response.json();
      console.log('4. 解析後的 JSON 資料:', data);
      
      if (data.success) {
        const normalizedAreas = (data.areas || []).map(normalizeDetectedArea);
        setAreas(normalizedAreas);
        setActiveArea(normalizedAreas[0]?.id || 1);
        setActiveTab('action');
      } else {
        alert('AI 偵測失敗: ' + (data.error || '未知錯誤'));
        setAreas([]);
        setActiveTab('image');
        // 保留 bgImage，讓使用者仍可看到並繼續編輯圖片預覽
      }
    } catch (error) {
      console.error('❌ 發生例外錯誤:', error);
      alert('圖片已載入，但 AI 座標偵測服務目前無法連線。您仍可看到圖片預覽，稍後再重新偵測。');
      setAreas([]);
      setActiveTab('image');
      // 不清除 bgImage：AI 失敗不應影響圖片預覽
    } finally {
      setIsUploading(false);
      setIsDetecting(false);
      event.target.value = ''; 
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 animate-in fade-in duration-300">
      {isLoadingTemplate && <div className="absolute inset-0 z-50 bg-white/70 flex items-center justify-center"><Loader2 className="animate-spin mr-2" size={20} />載入模板中...</div>}
      <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900">{isTemplateMode ? templateName : '2024 春季新品導覽'}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${templateStatus === 'verified' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>{templateStatus === 'verified' ? '已驗證模板' : '草稿'}</span>
            </div>
            <p className="text-xs text-gray-500">{isTemplateMode ? '模板製作模式：座標、Action 與導航規則只需設定一次' : '正在編輯：首頁 (1/4)'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isTemplateMode ? (
            <>
              <button onClick={() => saveTemplate('draft')} className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2">儲存模板草稿</button>
              <button onClick={() => saveTemplate('verified')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-md text-sm font-medium transition-colors shadow-sm">驗證並加入模板庫</button>
            </>
          ) : (
            <>
              <button className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2">儲存草稿</button>
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-md text-sm font-medium transition-colors shadow-sm">發布至 LINE</button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 min-w-[400px] border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
          <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10">
            <button 
              onClick={() => setActiveTab('image')}
              className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${activeTab === 'image' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <ImageIcon size={16} />
              1. 圖片與版型
            </button>
            <button 
              onClick={() => setActiveTab('action')}
              disabled={areas.length === 0}
              className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${areas.length === 0 ? 'opacity-50 cursor-not-allowed' : ''} ${activeTab === 'action' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <Settings size={16} />
              2. 動作設定
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'image' && (
              <div className="space-y-6">
                {isTemplateMode && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <label className="block text-sm font-bold text-gray-900 mb-2">模板名稱</label>
                    <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="例如：餐飲 12 格功能版" />
                    <p className="text-xs text-gray-500 mt-2">這裡建立的是「母版」；客戶日後選用時只替換內容，不重新計算座標。</p>
                  </div>
                )}
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-6 rounded-xl border border-indigo-100">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 mt-1">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">AI 智能建立模板座標 (Gemini)</h3>
                      <p className="text-xs text-gray-600 mt-1 mb-4 leading-relaxed">
                        上傳您設計好的選單底圖，只在建立新模板時呼叫 AI 分析圖片，確認後座標會寫入模板庫，之後相同版型直接重複使用。
                      </p>
                      
                      <input 
                        type="file" 
                        accept="image/jpeg, image/png, image/webp" 
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                      />

                      {!bgImage ? (
                        <button 
                          onClick={handleUploadAndDetect}
                          disabled={isUploading}
                          className="w-full bg-white border-2 border-dashed border-indigo-300 rounded-lg p-8 flex flex-col items-center justify-center text-indigo-600 hover:bg-indigo-50/50 hover:border-indigo-400 transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-wait"
                        >
                          {isUploading ? (
                            <>
                              <Loader2 size={24} className="animate-spin mb-2" />
                              <span className="text-sm font-medium">圖片上傳中...</span>
                            </>
                          ) : (
                            <>
                              <UploadCloud size={28} className="mb-2" />
                              <span className="text-sm font-bold">點擊上傳圖文選單圖片</span>
                              <span className="text-xs text-indigo-400 font-normal mt-1">建議尺寸 2500x1686 JPG/PNG</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="bg-white p-4 rounded-lg border border-indigo-200">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                              <CheckCircle2 size={16} className="text-green-500" />
                              圖片已就緒
                            </span>
                            <button className="text-xs text-red-500 hover:text-red-700 font-medium" onClick={() => { setBgImage(null); setAreas([]); setSelectedFile(null); setAssetId(null); }}>移除圖片</button>
                          </div>
                          
                          {isDetecting ? (
                            <div className="flex flex-col items-center py-4 text-indigo-600">
                              <Loader2 size={24} className="animate-spin mb-2" />
                              <span className="text-sm font-bold">AI 視覺分析中... 正在尋找按鈕區塊</span>
                            </div>
                          ) : (
                            <div className="bg-green-50 text-green-800 text-sm p-3 rounded-md border border-green-200 flex flex-col gap-2">
                              <div className="font-bold">✅ AI 偵測完成！</div>
                              <p className="text-xs opacity-90">成功辨識出 {areas.length} 個可點擊區塊，已自動切換至「動作設定」頁籤。</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'action' && areas.length > 0 && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <MousePointerClick size={16} className="text-blue-600"/>
                    選擇要編輯的區塊
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {areas.map(area => (
                      <button
                        key={area.id}
                        onClick={() => setActiveArea(area.id)}
                        className={`py-2 px-2 text-xs font-medium rounded-md border transition-all truncate ${
                          activeArea === area.id 
                            ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500 shadow-sm' 
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        {area.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(() => {
                  const currentArea = areas.find(a => a.id === activeArea);
                  const action = currentArea?.action || { type: 'uri', uri: '' };
                  if (!currentArea) return null;

                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                        <div>
                          <h4 className="font-bold text-gray-900">設定【{currentArea.label}】的行為</h4>
                          <p className="text-xs text-gray-500 mt-1">這是模板的預設行為；日後使用此模板的專案會直接繼承。</p>
                        </div>
                        <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">模板預設</span>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">動作類型</label>
                        <select
                          value={action.type || 'uri'}
                          onChange={(e) => setAreaActionType(currentArea.id, e.target.value)}
                          className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        >
                          {ACTION_TYPES.map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </div>

                      {action.type === 'uri' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">網址 (URI)</label>
                          <div className="relative">
                            <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={action.uri || ''}
                              onChange={(e) => updateAreaAction(currentArea.id, { uri: e.target.value })}
                              placeholder="https:// 或 tel: / mailto:"
                              className="w-full border border-gray-300 rounded-md py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {action.type === 'message' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">傳送文字</label>
                          <textarea
                            value={action.text || ''}
                            onChange={(e) => updateAreaAction(currentArea.id, { text: e.target.value })}
                            placeholder="例如：我要預約"
                            rows={3}
                            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                          />
                        </div>
                      )}

                      {action.type === 'postback' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Postback Data</label>
                            <input
                              type="text"
                              value={action.data || ''}
                              onChange={(e) => updateAreaAction(currentArea.id, { data: e.target.value })}
                              placeholder="例如：action=booking"
                              className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">顯示文字（選填）</label>
                            <input
                              type="text"
                              value={action.displayText || ''}
                              onChange={(e) => updateAreaAction(currentArea.id, { displayText: e.target.value })}
                              placeholder="例如：我要預約"
                              className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                        </>
                      )}

                      {action.type === 'richmenuswitch' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">切換目標頁面</label>
                            <select
                              value={action.targetPageId || 'page_home'}
                              onChange={(e) => updateAreaAction(currentArea.id, { targetPageId: e.target.value })}
                              className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            >
                              {PAGES.map(page => (
                                <option key={page.id} value={page.id}>{page.label}</option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">Alias 將由發布引擎自動建立，這裡只選頁面。</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Postback Data（選填）</label>
                            <input
                              type="text"
                              value={action.data || ''}
                              onChange={(e) => updateAreaAction(currentArea.id, { data: e.target.value })}
                              placeholder="例如：switch=member"
                              className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                        </>
                      )}

                      {action.type === 'none' && (
                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                          此區塊將保留在模板中，但發布時不建立可點擊 Action。
                        </div>
                      )}

                      <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
                        <div className="text-xs font-bold text-slate-700 mb-1">目前設定</div>
                        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all">{JSON.stringify(action, null, 2)}</pre>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        <div className="w-1/2 bg-gray-100 flex items-center justify-center p-8 relative overflow-y-auto">
          <div className="w-[350px] h-[700px] bg-white rounded-[40px] shadow-2xl border-[8px] border-gray-800 relative overflow-hidden flex flex-col">
            
            <div className="h-16 bg-[#06C755] flex items-center px-4 text-white font-bold shrink-0">
              <ArrowLeft size={20} className="mr-3" />
              <div className="flex flex-col">
                <span className="text-sm">Coffee Shop 總店</span>
                <span className="text-[10px] opacity-80">官方帳號</span>
              </div>
            </div>

            <div className="flex-1 bg-[#849EB2] p-4 flex flex-col justify-end">
              <div className="bg-white text-gray-800 text-sm p-3 rounded-2xl rounded-tl-none self-start max-w-[80%] mb-4 shadow-sm relative">
                歡迎來到 Coffee Shop！點擊下方選單查看最新優惠。
              </div>
            </div>

            <div className="bg-white border-t border-gray-300 relative group">
              <div className="w-full aspect-[2500/1686] bg-gray-200 relative overflow-hidden flex items-center justify-center">
                
                {bgImage ? (
                  <img src={bgImage} alt="Rich Menu Background" className={`w-full h-full object-contain transition-opacity duration-1000 ${isDetecting ? 'opacity-50 blur-sm' : 'opacity-100'}`} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 flex-col gap-2">
                    <ImageIcon size={32} />
                    <span className="text-xs">尚無圖片</span>
                  </div>
                )}

                {areas.length > 0 && !isDetecting && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    {areas.map(area => (
                      <div 
                        key={area.id}
                        onClick={() => setActiveArea(area.id)}
                        style={area.style}
                        className={`absolute border-[1px] border-red-500 pointer-events-auto flex flex-col items-center justify-center cursor-pointer transition-all ${
                          activeArea === area.id 
                            ? 'bg-red-500/40 ring-2 ring-inset ring-red-500 z-10' 
                            : 'bg-red-500/20 hover:bg-red-500/30'
                        }`}
                      >
                        <span className="bg-red-600 text-white text-[10px] font-bold px-1 rounded shadow">
                          {area.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="h-10 border-t border-gray-200 flex items-center justify-center text-gray-700 text-sm font-medium bg-gray-50">
                選單
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function AppShell() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);

  const loadSession = async () => {
    const token = getAuthToken();

    if (!token) {
      setSession(null);
      setAuthReady(true);
      return;
    }

    try {
      const res = await authFetch('/api/auth/me');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || '登入狀態失效');
      }

      setSession(data);
      const platformAdminMode =
        Boolean(data?.user?.is_system_admin) &&
        String(data?.activeWorkspaceId || '') === 'default';

      if (platformAdminMode) {
        setCurrentView('accounts');
      } else if (
        ['accounts', 'workspace-account', 'tenant-inventory', 'tenant-integrity'].includes(currentView)
      ) {
        setCurrentView('dashboard');
      }
    } catch (e) {
      console.error(e);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setSession(null);
    } finally {
      setAuthReady(true);
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const logout = async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {}

    localStorage.removeItem(AUTH_TOKEN_KEY);
    setSession(null);
    setCurrentView('dashboard');
  };

  const createTemplate = () => {
    setCurrentTemplateId(null);
    setCurrentView('template-builder');
  };

  const editTemplate = (templateId) => {
    setCurrentTemplateId(templateId);
    setCurrentView('template-builder');
  };

  const startNewProject = () => {
    setCurrentProjectId(null);
    setCurrentView('project-builder');
  };

  const editProject = (projectId) => {
    setCurrentProjectId(projectId);
    setCurrentView('project-editor');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center gap-2 text-gray-600">
        <Loader2 size={20} className="animate-spin" />
        驗證登入狀態...
      </div>
    );
  }

  if (!session) {
    return (
      <LoginView
        onLoggedIn={async () => {
          setAuthReady(false);
          await loadSession();
          setCurrentView('dashboard');
        }}
      />
    );
  }

  const activeWorkspace =
    session.memberships?.find(x => x.workspace_id === session.activeWorkspaceId);

  const isSystemAdmin = Boolean(session?.user?.is_system_admin);
  const isPlatformAdminMode =
    isSystemAdmin &&
    String(session?.activeWorkspaceId || '') === 'default';
  const activeRole = String(session?.activeRole || 'viewer').toLowerCase();

  const visibleNavigation = isPlatformAdminMode
    ? NAVIGATION.filter(item => ['accounts', 'templates', 'ai-usage', 'intelligence-health', 'tenant-inventory', 'tenant-integrity'].includes(item.id))
    : NAVIGATION.filter(item => {
        if (item.id === 'accounts') return false;
        if (item.id === 'members') return activeRole === 'owner' || activeRole === 'admin';
        if (item.id === 'settings') return activeRole === 'owner' || activeRole === 'admin';
        return ['dashboard', 'projects', 'templates', 'ai-usage'].includes(item.id);
      });

  const navigateHome = () => {
    setCurrentView(isPlatformAdminMode ? 'accounts' : 'dashboard');
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200">
        <div className="h-16 flex items-center px-6 border-b border-gray-200 cursor-pointer" onClick={navigateHome}>
          <div className="w-8 h-8 bg-black rounded-md flex items-center justify-center mr-3">
            <span className="text-white font-bold text-sm">SM</span>
          </div>
          <span className="font-bold text-gray-900">{isPlatformAdminMode ? 'Smart Menu 管理後台' : 'Smart Menu Studio'}</span>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          {isPlatformAdminMode ? (
            <>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">PLATFORM</div>
              <div className="text-sm font-semibold text-gray-800 mt-1">系統管理端</div>
              <div className="text-xs text-blue-600 mt-0.5">System Admin</div>
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Workspace</div>
              <div className="text-sm font-semibold text-gray-800 mt-1 truncate">
                {activeWorkspace?.workspace_name || session.activeWorkspaceId}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{session.activeRole}</div>
            </>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-2">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              currentView === item.id ||
              (currentView === 'template-builder' && item.id === 'templates') ||
              ((currentView === 'project-builder' || currentView === 'project-editor') && item.id === 'projects');

            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}

          <button
            onClick={() => setCurrentView('account')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
              currentView === 'account' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Users size={18} />
            我的帳號
          </button>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={18} />
            登出
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <div className="text-sm text-gray-500">
            {isPlatformAdminMode ? '系統管理 / ' : 'Workspace / '}<span className="font-medium text-gray-900">
              {currentView === 'template-builder'
                ? '模板中心 / 建立模板'
                : currentView === 'project-builder'
                  ? '圖文選單專案 / 新增專案'
                  : currentView === 'project-editor'
                    ? '圖文選單專案 / 內容設定'
                    : currentView === 'account'
                      ? '我的帳號'
                      : (NAVIGATION.find(n => n.id === currentView)?.label || '工作區')}
            </span>
          </div>

          <div className="text-right">
            <div className="text-sm font-medium text-gray-800">
              {session.user?.display_name || '使用者'}
            </div>
            <div className="text-xs text-gray-500">{session.activeRole}</div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className={currentView === 'project-editor' ? 'h-full' : 'max-w-6xl mx-auto'}>
            {currentView === 'dashboard' && !isPlatformAdminMode && <DashboardView onNavigate={setCurrentView} />}
            {currentView === 'projects' && !isPlatformAdminMode && (
              <ProjectsView onStartNew={startNewProject} onEditProject={editProject} />
            )}
            {currentView === 'project-builder' && (
              <ProjectBuilderView
                onBack={() => setCurrentView('projects')}
                onCreated={(projectId) => {
                  setCurrentProjectId(projectId);
                  setCurrentView('project-editor');
                }}
              />
            )}
            {currentView === 'project-editor' && (
              <ProjectEditorView
                projectId={currentProjectId}
                userRole={activeRole}
                onStartNew={startNewProject}
                onBack={() => setCurrentView('projects')}
                onGuideNavigate={(target) => {
                  if (target !== 'line-hub') return false;
                  setCurrentView('member-linehub');
                  return true;
                }}
              />
            )}
            {currentView === 'tenant-integrity' && isPlatformAdminMode && (
              <TenantIntegrityView />
            )}
            {currentView === 'tenant-inventory' && isPlatformAdminMode && (
              <TenantInventoryView />
            )}
            {currentView === 'accounts' && isPlatformAdminMode && (
              <CustomerAccountsView
                onOpenWorkspace={(workspace) => {
                  setSelectedWorkspace(workspace);
                  setCurrentView('workspace-account');
                }}
              />
            )}
            {currentView === 'workspace-account' && isPlatformAdminMode && selectedWorkspace && (
              <WorkspaceAccountView
                workspace={selectedWorkspace}
                onBack={() => {
                  setSelectedWorkspace(null);
                  setCurrentView('accounts');
                }}
              />
            )}
            {currentView === 'members' && (activeRole === 'owner' || activeRole === 'admin') && (
              <MembersView
                onOpenAccount={(member) => {
                  setSelectedMember(member);
                  setCurrentView('member-linehub');
                }}
              />
            )}
            {currentView === 'member-linehub' && (
              <LineHubView
                member={selectedMember}
                projectId={currentProjectId}
                onBack={() => {
                  setSelectedMember(null);
                  setCurrentView('members');
                }}
              />
            )}
            {currentView === 'account' && (
              <AccountView session={session} onSessionChanged={loadSession} />
            )}
            {currentView === 'settings' && !isPlatformAdminMode && (
              <><ConversionApiKeyPanel request={authFetch} userRole={activeRole} /><LiffReferralConfigPanel request={authFetch} userRole={activeRole} /><ReferralGrowthPanel request={authFetch} /></>
            )}
            {currentView === 'ai-usage' && (
              <AIUsagePanel request={authFetch} systemAdmin={isPlatformAdminMode} />
            )}
            {currentView === 'intelligence-health' && isPlatformAdminMode && (
              <LineIntelligenceHealthPanel request={authFetch} />
            )}
            {currentView === 'templates' && isPlatformAdminMode && (
              <SystemTemplatesView />
            )}
            {currentView === 'templates' && !isPlatformAdminMode && (
              <TemplatesView onNavigate={createTemplate} onEditTemplate={editTemplate} />
            )}
            {currentView === 'template-builder' && !isPlatformAdminMode && (
              <EditorView
                mode="template"
                templateId={currentTemplateId}
                onBack={() => {
                  setCurrentTemplateId(null);
                  setCurrentView('templates');
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return window.location.pathname === '/liff/referral' ? <LiffReferralPage /> : <AppShell />;
}

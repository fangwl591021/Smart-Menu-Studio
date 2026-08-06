import React, { useState } from 'react';

export default function DashboardLayout() {
  const [activeMenu, setActiveMenu] = useState('smart-menu');

  return (
    <div className="flex h-screen bg-[#F4F5F7] text-gray-800 font-sans">
      {/* 1. 左側選單 (Sidebar) - 復刻 LINE OA 結構 */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 shadow-sm z-20">
        {/* 平台 Logo 區 */}
        <div className="h-14 flex items-center px-6 border-b border-gray-200">
          <div className="w-6 h-6 bg-[#06C755] rounded mr-2 flex items-center justify-center">
            <span className="text-white font-bold text-xs">S</span>
          </div>
          <span className="font-bold text-sm tracking-wide text-gray-700">Smart Menu Studio</span>
        </div>

        {/* 選單列表 */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => setActiveMenu('home')}
                className={`w-full flex items-center px-6 py-2.5 text-sm transition-colors ${
                  activeMenu === 'home'
                    ? 'bg-[#E6F9EE] text-[#06C755] font-medium border-r-4 border-[#06C755]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                主頁 (Dashboard)
              </button>
            </li>
            
            {/* 聊天室相關分類 */}
            <div className="px-6 py-2 mt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              聊天室相關
            </div>
            <li>
              <button
                onClick={() => setActiveMenu('smart-menu')}
                className={`w-full flex items-center px-6 py-2.5 text-sm transition-colors ${
                  activeMenu === 'smart-menu'
                    ? 'bg-[#E6F9EE] text-[#06C755] font-medium border-r-4 border-[#06C755]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                圖文選單 (Smart Menu)
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveMenu('flex-msg')}
                className={`w-full flex items-center px-6 py-2.5 text-sm transition-colors ${
                  activeMenu === 'flex-msg'
                    ? 'bg-[#E6F9EE] text-[#06C755] font-medium border-r-4 border-[#06C755]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                進階圖文訊息 (Flex)
              </button>
            </li>

            {/* 設定分類 */}
            <div className="px-6 py-2 mt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              帳號設定
            </div>
            <li>
              <button
                onClick={() => setActiveMenu('settings')}
                className={`w-full flex items-center px-6 py-2.5 text-sm transition-colors ${
                  activeMenu === 'settings'
                    ? 'bg-[#E6F9EE] text-[#06C755] font-medium border-r-4 border-[#06C755]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                權限與品牌管理
              </button>
            </li>
          </ul>
        </nav>
      </aside>

      {/* 2. 右側主工作區 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 頂部導覽列 (Global Header) */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
              {/* 這裡未來放品牌 Logo */}
              <span className="text-xs font-bold text-gray-500">Logo</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-800">TONY 行銷工作室 (示範品牌)</h1>
              <p className="text-xs text-gray-500">進階版方案</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 text-sm">
            <button className="text-gray-500 hover:text-gray-800">通知</button>
            <div className="w-px h-4 bg-gray-300"></div>
            <button className="text-gray-500 hover:text-gray-800 font-medium">Tony (擁有者) ▼</button>
          </div>
        </header>

        {/* 3. 內容與預覽區 (雙欄設計) */}
        <main className="flex-1 overflow-hidden flex">
          {/* 左側：編輯表單 */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-800">建立智能圖文選單</h2>
                <button className="bg-[#06C755] hover:bg-[#05B34C] text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition-colors">
                  一鍵發布至 LINE
                </button>
              </div>

              {/* 編輯卡片 */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-md font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">1. 選擇營運模板</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border-2 border-[#06C755] bg-[#E6F9EE] rounded-lg p-4 cursor-pointer relative">
                    <div className="absolute top-2 right-2 w-4 h-4 bg-[#06C755] rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="font-bold text-sm text-[#06C755]">美容預約套組 (三頁式)</p>
                    <p className="text-xs text-gray-600 mt-1">包含首頁、會員中心、預約功能</p>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-[#06C755] transition-colors">
                    <p className="font-bold text-sm text-gray-700">餐飲集點版 (雙頁式)</p>
                    <p className="text-xs text-gray-500 mt-1">包含點餐、集點、優惠券</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-md font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">2. 設定按鈕動作 (首頁)</h3>
                <div className="space-y-4">
                  <div className="flex items-start space-x-4">
                    <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 mt-1">A</span>
                    <div className="flex-1 space-y-3">
                       <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">按鈕顯示名稱</label>
                          <input type="text" defaultValue="會員中心" className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#06C755] focus:ring-1 focus:ring-[#06C755] outline-none transition-shadow" />
                       </div>
                       <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">動作類型</label>
                          <select className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#06C755] focus:ring-1 focus:ring-[#06C755] outline-none transition-shadow">
                            <option>切換頁面 (Smart Menu Switch)</option>
                            <option>開啟網址 (URI)</option>
                            <option>傳送文字 (Message)</option>
                          </select>
                       </div>
                       <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">目標頁面</label>
                           <select className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#06C755] focus:ring-1 focus:ring-[#06C755] outline-none transition-shadow">
                            <option>Page 2: 會員中心</option>
                            <option>Page 3: 預約服務</option>
                          </select>
                       </div>
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-4 flex items-start space-x-4">
                    <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 mt-1">B</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-500 italic mt-2">設定其他按鈕...</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右側：互動模擬器 (固定於右側) */}
          <div className="w-[380px] bg-gray-50 border-l border-gray-200 p-6 flex flex-col items-center justify-center relative shadow-inner">
            <div className="absolute top-4 left-4 flex items-center space-x-2 text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-200">
              <span className="w-2 h-2 rounded-full bg-[#06C755] animate-pulse"></span>
              <span>即時互動預覽 (首頁)</span>
            </div>
            
            {/* 手機外框 */}
            <div className="w-[320px] h-[640px] bg-white rounded-[2.5rem] shadow-2xl border-[12px] border-gray-800 overflow-hidden flex flex-col relative">
              {/* 手機瀏海 */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-xl z-30"></div>

              {/* LINE Header 模擬 */}
              <div className="h-20 bg-[#272728] flex flex-col justify-end pb-3 px-4 text-white z-20">
                <div className="flex items-center space-x-3">
                   <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-xs">Logo</div>
                   <p className="text-sm font-medium">TONY 行銷工作室</p>
                </div>
              </div>
              
              {/* 聊天室內容區 */}
              <div className="flex-1 bg-[#749BBB] p-4 flex flex-col justify-end space-y-3">
                 <div className="bg-white/20 text-center rounded-full py-1 px-3 self-center text-[10px] text-white mb-2">今天</div>
                <div className="flex space-x-2">
                    <div className="w-8 h-8 bg-gray-400 rounded-full flex-shrink-0 mt-1"></div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 text-sm max-w-[75%] shadow-sm text-gray-800">
                    歡迎來到我們的官方帳號！請使用下方選單探索更多服務。
                    </div>
                </div>
              </div>

              {/* 模擬圖文選單 (6宮格) */}
              <div className="h-[215px] bg-gray-100 grid grid-cols-2 grid-rows-3 gap-[1px] relative cursor-pointer border-t border-gray-200">
                {/* 這是預覽的視覺佔位 */}
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center group transition-colors relative overflow-hidden">
                    <div className="absolute inset-0 bg-[#06C755]/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <span className="text-gray-400 text-xs mb-1 font-bold">A</span>
                    <span className="text-gray-800 text-sm font-medium">會員中心</span>
                </div>
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
                    <span className="text-gray-400 text-xs mb-1 font-bold">B</span>
                    <span className="text-gray-800 text-sm font-medium">最新活動</span>
                </div>
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
                     <span className="text-gray-400 text-xs mb-1 font-bold">C</span>
                    <span className="text-gray-800 text-sm font-medium">預約服務</span>
                </div>
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
                     <span className="text-gray-400 text-xs mb-1 font-bold">D</span>
                    <span className="text-gray-800 text-sm font-medium">優惠券</span>
                </div>
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
                     <span className="text-gray-400 text-xs mb-1 font-bold">E</span>
                    <span className="text-gray-800 text-sm font-medium">品牌介紹</span>
                </div>
                <div className="bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
                     <span className="text-gray-400 text-xs mb-1 font-bold">F</span>
                    <span className="text-gray-800 text-sm font-medium">更多資訊</span>
                </div>
              </div>
              
              {/* 模擬 LINE 底部輸入區 */}
              <div className="h-12 bg-[#F5F5F5] flex items-center px-4 text-gray-500 text-sm border-t border-gray-200">
                <svg className="w-5 h-5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                <div className="flex-1 bg-white h-8 rounded-full border border-gray-300 px-3 flex items-center text-xs text-gray-400">Aa</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

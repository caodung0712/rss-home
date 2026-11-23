"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "vi" | "en";

const DICTS = {
  vi: {
    // Common
    appTitle: "RSS Home — Trình đọc tin tự host",
    feeds: "Feeds",
    newsfeed: "Newsfeed",
    saved: "Đã lưu",
    folders: "Thư mục",
    tags: "Tags",
    manageContent: "Quản lý nội dung & Cài đặt",
    addSource: "Thêm nguồn mới",
    systemStatus: "Trạng thái hệ thống",
    settings: "Cài đặt",
    darkMode: "Chế độ sáng / tối",
    logout: "Đăng xuất",
    backToReader: "Về đọc tin",
    saveChanges: "Lưu thay đổi",
    saving: "Đang lưu...",
    cancel: "Huỷ",
    delete: "Xoá",
    rename: "Đổi tên",
    apply: "Áp dụng",
    create: "Tạo",
    refresh: "Làm mới",
    loading: "Đang tải...",
    close: "Đóng",
    search: "Tìm",
    clearFilter: "Xoá lọc",
    all: "Tất cả",
    unread: "Chưa đọc",
    read: "Đã đọc",
    justNow: "vừa xong",
    language: "Ngôn ngữ",
    vietnamese: "Tiếng Việt",
    english: "English",

    // ReaderApp
    toggleSidebar: "Ẩn/hiện thanh Feeds",
    createFolderPrompt: "Tên thư mục mới:",
    createFolderTitle: "Tạo thư mục mới",
    toggleAllFolders: "Thu gọn / mở rộng tất cả thư mục",
    refreshFeeds: "Làm mới feeds",
    markAllRead: "Đọc hết",
    markAllReadTitle: "Đánh dấu tất cả đã đọc (Shift+A)",
    markAllAsReadMenu: "Đánh dấu tất cả đã đọc",
    olderThan1Day: "Cũ hơn 1 ngày",
    olderThan1Week: "Cũ hơn 1 tuần",
    markOnScroll: "Đọc khi cuộn",
    markOnScrollTitle: "Tự động đánh dấu đã đọc khi cuộn qua",
    select: "Chọn",
    selectTitle: "Chế độ chọn nhiều bài để xuất ZIP / gắn tag",
    searchFilterTitle: "Tìm kiếm & lọc ngày",
    searchPlaceholder: "Tìm từ khoá trong tiêu đề hoặc nội dung...",
    fromDate: "Từ:",
    toDate: "Đến:",
    selectedArticlesCount: "Đã chọn {count} bài",
    applyAllFilterSuffix: " (áp dụng toàn bộ bộ lọc ~{max} bài)",
    selectAllByFilter: "Chọn tất cả theo bộ lọc",
    deselect: "Bỏ chọn",
    exportZip: "Xuất ZIP (MD + ảnh + CSV)",
    compressing: "Đang nén...",
    copyAllMarkdown: "Copy tất cả Markdown",
    markAsRead: "Đánh dấu đã đọc",
    bulkTagBtn: "Gắn tag",
    bulkTagPlaceholder: "Nhập tên tag rồi Enter...",
    noArticles: "Không có bài viết nào",
    noArticlesHint:
      'Thử chuyển sang mục "Tất cả" hoặc nhấn làm mới để quét thêm tin.',
    loadingMore: "Đang tải thêm bài cũ hơn...",
    loadMoreBtn: "Xem thêm (~20 bài cũ hơn)",
    endOfList: "Đã hiển thị hết danh sách",
    fetchFullText: "Lấy toàn văn",
    fetchingFullText: "Đang lấy...",
    copyText: "Copy text",
    copyMarkdown: "Copy Markdown",
    copyTextLink: "Copy text + link",
    downloadAllImages: "Tải tất cả ảnh ({count})",
    copyImageTip: "Mẹo: bấm trực tiếp vào ảnh bên dưới để copy ảnh",
    bookmarkTitle: "Lưu bài viết (s)",
    toggleReadTitle: "Đánh dấu đã đọc / chưa đọc (m)",
    openOriginalTitle: "Mở bài gốc (v)",
    prevArticleTitle: "Bài trước (k)",
    nextArticleTitle: "Bài tiếp (j)",
    feedProperties: "Thuộc tính feed",
    renameFeed: "Đổi tên feed",
    setStartPage: "Đặt làm trang mặc định",
    moveToFolder: "Chuyển vào thư mục",
    filterFeed: "Lọc bài feed",
    unfollow: "Huỷ theo dõi",
    viewSavedOnly: "Chỉ xem bài đã lưu",
    manageTags: "Quản lý Tags",
    addTag: "+ Tag",
    tagInputPlaceholder: "Nhập tag mới hoặc chọn có sẵn...",
    noTagsYet: "Chưa có tag nào",
    createQuickTagPrompt: "Tên tag mới (chủ đề):",
    removeTagTitle: "Bỏ tag khỏi bài viết",
    chooseTagsTitle: "Gắn / bỏ tag bài viết",

    // Toasts
    toastLoadEntriesErr: "Không tải được danh sách bài viết.",
    toastAddedOlder: "Đã tải thêm {count} bài cũ hơn.",
    toastNoMoreOlder: "Không còn bài cũ hơn từ nguồn này.",
    toastErrOlder: "Lỗi khi tải thêm bài cũ từ nguồn.",
    toastErrLoadMore: "Không tải thêm được bài cũ.",
    toastErrMarkStatus: "Lỗi cập nhật trạng thái đọc.",
    toastErrOpenArticle: "Không mở được nội dung bài viết.",
    toastErrBookmark: "Không cập nhật được bookmark.",
    toastFetchedFull: "Đã lấy toàn văn bài viết.",
    toastErrFetchedFull: "Không lấy được toàn văn từ trang gốc.",
    toastMarkedOlderDays: "Đã đánh dấu đọc các bài cũ hơn {days} ngày.",
    toastMarkedAllRead: "Đã đánh dấu tất cả là đã đọc.",
    toastErrMarkAllRead: "Lỗi khi đánh dấu tất cả đã đọc.",
    toastRefreshedFeed: 'Đã làm mới "{title}".',
    toastRefreshedAll: "Đã yêu cầu Miniflux quét lại các feed.",
    toastErrRefresh: "Không làm mới được feed.",
    toastCopied: "Đã copy {label}.",
    toastCopiedImg: "Đã copy ảnh vào clipboard!",
    toastErrCopy: "Trình duyệt không cho phép copy tự động.",
    toastErrCopyImg: "Không copy được ảnh trực tiếp, hãy thử tải ZIP ảnh.",
    toastSelectedAllMax:
      "Đã chọn toàn bộ theo bộ lọc hiện tại (tối đa 200 bài khi xuất ZIP).",
    toastSelectedAll: "Đã chọn tất cả {count} bài.",
    toastExportedZip: "Đã xuất file ZIP thành công!",
    toastErrZip: "Lỗi khi xuất ZIP.",
    toastCopiedAllMd: "Đã copy {count} bài thành một khối Markdown!",
    toastErrCopyMd: "Lỗi copy Markdown hàng loạt.",
    toastCreatedFolder: 'Đã tạo thư mục "{title}".',
    toastErrCreateFolder: "Không tạo được thư mục.",
    toastRenamedFeed: 'Đã đổi tên thành "{title}".',
    toastErrRenameFeed: "Không đổi tên được feed.",
    toastMovedFeed: 'Đã chuyển "{title}" sang thư mục mới.',
    toastErrMoveFeed: "Không chuyển được thư mục.",
    toastUnfollowed: 'Đã huỷ theo dõi "{title}".',
    toastErrUnfollow: "Không huỷ theo dõi được feed.",
    toastSetStartPage: 'Đã đặt "{title}" làm trang mặc định khi mở.',
    toastTagUpdated: "Đã cập nhật tag.",
    toastTagErr: "Không cập nhật được tag.",
    toastBulkTagged: 'Đã gắn tag "{tag}" cho {count} bài.',

    // FeedModals
    modalProperties: "Thuộc tính",
    modalFilter: "Bộ lọc từ khoá",
    modalLoading: "Đang tải thông tin...",
    modalDisplayName: "Tên hiển thị",
    modalFolder: "Thư mục",
    modalFeedUrl: "Feed URL",
    modalSiteUrl: "Trang gốc (Site URL)",
    modalCrawler: "Tự lấy toàn văn (Crawler)",
    modalEnabled: "Đang bật (Enabled)",
    modalErrorsCount: "Lỗi ({count} lần):",
    modalUnknownErr: "Không rõ nguyên nhân",
    modalFilterDesc:
      "Dùng quy tắc lọc Regex hoặc từ khoá của Miniflux (mỗi mẫu ngăn cách bằng dấu `|`, không phân biệt hoa thường với `(?i)tu-khoa`).",
    modalKeeplist: "Chỉ giữ bài chứa từ khoá (Keeplist rules)",
    modalBlocklist: "Chặn bài chứa từ khoá (Blocklist rules)",
    modalRescanNow: "Quét lại ngay",
    modalSavedFeed: "Đã lưu cấu hình feed.",
    modalSaveFeedErr: "Lỗi khi lưu cấu hình feed.",
    modalRescanSent: 'Đã gửi yêu cầu quét lại "{title}".',

    // ContentManager (/manage)
    manageSubtitle: "Quản lý danh sách kênh, tags phân loại và cài đặt",
    tabFeeds: "Feeds",
    tabFolders: "Thư mục",
    tabTags: "Tags",
    tabSettings: "Cài đặt",
    addSourceShort: "Thêm nguồn",
    postgresLabel: "Postgres:",
    activeEntriesAutoClean:
      "{count} bài đang lưu · tự xoá sau {days} ngày (trừ bài ★)",
    redisCacheLabel: "Cache Redis:",
    redisKeysSuffix: "{count} keys RSSHub",
    clearCache: "Clear cache",
    cleanOldEntries: "Dọn bài cũ",
    allFeedsLabel: "Tất cả feeds",
    searchFeedsPlaceholder: "Tìm trong danh sách feeds...",
    allFoldersOpt: "Tất cả thư mục",
    allFeedTypesOpt: "Tất cả loại feed",
    showCountPrefix: "Hiện:",
    sortSize: "Sắp xếp: Dung lượng ↓",
    sortEntries: "Sắp xếp: Số bài ↓",
    sortName: "Sắp xếp: Tên A-Z",
    showUrl: "Hiện URL",
    pillAll: "Tất cả",
    pillDisabled: "Đang tắt",
    pillFiltered: "Có lọc",
    pillIssues: "Đang lỗi",
    selectedFeedsCount: "Đã chọn {count} feed",
    moveToFolderOpt: "Chuyển vào thư mục...",
    totalFeedsCount: "Tổng cộng: {count} feeds",
    colEnabled: "Bật",
    colFeed: "Feed",
    colStorage: "Dung lượng",
    colReadRate: "Tỷ lệ đọc",
    colChecked: "Quét",
    colLastPost: "Bài mới",
    colHealth: "Tình trạng",
    colActions: "Thao tác",
    loadingFeeds: "Đang tải danh sách feeds...",
    noMatchingFeeds: "Không có feed nào khớp điều kiện.",
    filterBadge: "Lọc",
    entriesSuffix: "bài",
    newFolderPlaceholder: "Tên thư mục mới...",
    createFolderBtn: "Tạo thư mục",
    folderStats: "({feeds} feeds · {unread} chưa đọc)",
    cleanupModalTitle: "Dọn bớt bài cũ",
    cleanupScopePrefix: "Phạm vi:",
    cleanupScopeNote: "Các bài bạn đã lưu (Bookmark ★) sẽ luôn được giữ lại.",
    cleanupOlderThan: "Xoá bài cũ hơn",
    cleanup180d: "Cũ hơn 180 ngày (6 tháng)",
    cleanup90d: "Cũ hơn 90 ngày (3 tháng)",
    cleanup30d: "Cũ hơn 30 ngày (1 tháng)",
    cleanup7d: "Cũ hơn 7 ngày",
    cleanup0d: "Tất cả bài đã đọc (mọi thời điểm)",
    cleanupIncludeUnread:
      "Bao gồm cả bài chưa đọc quá hạn (vẫn giữ bài đã lưu ★)",
    cleaning: "Đang dọn...",
    confirmCleanup: "Xác nhận dọn",

    // Tags Manager (/manage?tab=tags)
    tagsIntroTitle: "Quản lý Tags phân loại bài viết",
    tagsIntroDesc:
      "Tạo các nhãn (tag) theo chủ đề riêng của bạn, đổi màu sắc hoặc đổi tên. Sau đó bạn có thể tự tay gắn tag cho từng bài (hoặc chọn nhiều bài cùng lúc) ngay khi đọc để phân loại theo ý mình.",
    createTagTitle: "Tạo Tag mới hoặc đổi màu",
    tagNamePlaceholder: "Ví dụ: Đọc kỹ, Ý tưởng, AI, Kinh doanh...",
    createTagBtn: "Lưu Tag",
    viewTagArticles: "Xem bài",
    tagStats: "{total} bài · {unread} chưa đọc",
    renameTagPrompt: "Đổi tên tag:",
    confirmDeleteTag:
      'Xoá tag "{name}" khỏi tất cả bài viết?',

    // Settings tab (/manage?tab=settings)
    settingsLanguageTitle: "Ngôn ngữ giao diện (Language)",
    settingsLanguageDesc:
      "Chọn ngôn ngữ hiển thị cho toàn bộ ứng dụng đọc RSS và trang cài đặt.",
    langViDesc: "Giao diện tiếng Việt đầy đủ cho tất cả mục.",
    langEnDesc: "Full English interface across reader, tags, and settings.",
    settingsAppearanceTitle: "Giao diện & Lưu trữ",
    settingsThemeLabel: "Chế độ màu sắc",
    lightModeName: "Sáng (Light)",
    darkModeName: "Tối (Dark)",
    settingsRetentionTitle: "Tự động dọn dẹp dữ liệu",
    settingsRetentionDesc:
      "Bài viết đã đọc và chưa đọc (không gắn ★ Đã lưu) được tự động xoá sau {days} ngày.",

    // StatusDashboard
    statusBackBtn: "Quay lại đọc tin",
    statusTitle: "Trạng thái hệ thống",
    statusRecheck: "Kiểm tra lại",
    statusLoading: "Đang tải trạng thái hệ thống...",
    statusMinifluxFeeds: "Miniflux & Feeds",
    statusBrokenCount: "{count} feed đang lỗi",
    statusMinifluxLost: "Mất kết nối Miniflux",
    statusXCookie: "Cookie X (Twitter)",
    statusXNone: "Chưa thêm",
    statusXExpired: "Hết hạn",
    statusXOk: "Bình thường",
    statusXEmpty: "Chưa có feed X nào trong Miniflux",
    statusXSummary: "{broken}/{total} feed X lỗi",
    statusBackupTitle: "Sao lưu Postgres",
    statusBackupNone: "Chưa có bản sao lưu",
    statusBackupHint: "Chạy `make backup` để sao lưu ngay",
    statusApifyTitle: "Chi phí Apify tháng này",
    statusApifyWarn:
      "⚠️ Đã dùng vượt 80% ngân sách miễn phí ($5/tháng). Hãy giảm resultsLimit hoặc bớt trang ít ưu tiên.",
    statusApifyMissing: "Chưa cấu hình APIFY_TOKEN trong .env.",
    statusBrokenSection: "Feed đang lỗi ({count})",
    statusUpdatedAt: "Cập nhật:",
    statusAllHealthy: "✓ Tất cả các feed đều đang hoạt động ổn định.",
    statusErrorBadge: "{count} lỗi",

    // LoginPage
    loginSubtitle: "Trình đọc RSS tự host",
    loginPasswordLabel: "Mật khẩu truy cập",
    loginPlaceholder: "Nhập READER_UI_PASSWORD",
    loginBtn: "Đăng nhập",
    loginChecking: "Đang kiểm tra...",
    loginFailed: "Đăng nhập thất bại.",
    loginConnErr: "Không kết nối được máy chủ.",
  },
  en: {
    // Common
    appTitle: "RSS Home — Self-hosted RSS Reader",
    feeds: "Feeds",
    newsfeed: "Newsfeed",
    saved: "Saved",
    folders: "Folders",
    tags: "Tags",
    manageContent: "Manage Content & Settings",
    addSource: "Add source",
    systemStatus: "System status",
    settings: "Settings",
    darkMode: "Light / Dark mode",
    logout: "Sign out",
    backToReader: "Back to reader",
    saveChanges: "Save changes",
    saving: "Saving...",
    cancel: "Cancel",
    delete: "Delete",
    rename: "Rename",
    apply: "Apply",
    create: "Create",
    refresh: "Refresh",
    loading: "Loading...",
    close: "Close",
    search: "Search",
    clearFilter: "Clear filter",
    all: "All",
    unread: "Unread",
    read: "Read",
    justNow: "just now",
    language: "Language",
    vietnamese: "Tiếng Việt",
    english: "English",

    // ReaderApp
    toggleSidebar: "Toggle Feeds sidebar",
    createFolderPrompt: "New folder name:",
    createFolderTitle: "Create new folder",
    toggleAllFolders: "Expand / collapse all folders",
    refreshFeeds: "Refresh feeds",
    markAllRead: "Mark read",
    markAllReadTitle: "Mark all as read (Shift+A)",
    markAllAsReadMenu: "Mark all as read",
    olderThan1Day: "Older than 1 day",
    olderThan1Week: "Older than 1 week",
    markOnScroll: "Read on scroll",
    markOnScrollTitle: "Automatically mark as read when scrolling past",
    select: "Select",
    selectTitle: "Multi-select mode for ZIP export & tagging",
    searchFilterTitle: "Search & date filters",
    searchPlaceholder: "Search keywords in title or content...",
    fromDate: "From:",
    toDate: "To:",
    selectedArticlesCount: "{count} selected",
    applyAllFilterSuffix: " (all matching filter ~{max} entries)",
    selectAllByFilter: "Select all matching filter",
    deselect: "Clear selection",
    exportZip: "Export ZIP (MD + images + CSV)",
    compressing: "Zipping...",
    copyAllMarkdown: "Copy all Markdown",
    markAsRead: "Mark as read",
    bulkTagBtn: "Add tag",
    bulkTagPlaceholder: "Tag name + Enter...",
    noArticles: "No articles found",
    noArticlesHint:
      'Try switching to "All" or click Refresh to fetch newer articles.',
    loadingMore: "Loading older articles...",
    loadMoreBtn: "Load more (~20 older)",
    endOfList: "End of list",
    fetchFullText: "Fetch full text",
    fetchingFullText: "Fetching...",
    copyText: "Copy text",
    copyMarkdown: "Copy Markdown",
    copyTextLink: "Copy text + link",
    downloadAllImages: "Download all images ({count})",
    copyImageTip: "Tip: click any image below to copy it",
    bookmarkTitle: "Save article (s)",
    toggleReadTitle: "Toggle read / unread (m)",
    openOriginalTitle: "Open original (v)",
    prevArticleTitle: "Previous article (k)",
    nextArticleTitle: "Next article (j)",
    feedProperties: "Feed properties",
    renameFeed: "Rename feed",
    setStartPage: "Set as start page",
    moveToFolder: "Move to folder",
    filterFeed: "Filter feed articles",
    unfollow: "Unsubscribe",
    viewSavedOnly: "Saved articles only",
    manageTags: "Manage Tags",
    addTag: "+ Tag",
    tagInputPlaceholder: "Type new or pick existing tag...",
    noTagsYet: "No tags yet",
    createQuickTagPrompt: "New tag name:",
    removeTagTitle: "Remove tag from article",
    chooseTagsTitle: "Tag / untag article",

    // Toasts
    toastLoadEntriesErr: "Failed to load articles.",
    toastAddedOlder: "Loaded {count} older articles.",
    toastNoMoreOlder: "No older articles available from this source.",
    toastErrOlder: "Error loading older articles from source.",
    toastErrLoadMore: "Failed to load older articles.",
    toastErrMarkStatus: "Failed to update read status.",
    toastErrOpenArticle: "Failed to open article content.",
    toastErrBookmark: "Failed to update bookmark.",
    toastFetchedFull: "Fetched full article text.",
    toastErrFetchedFull: "Could not extract full text from source URL.",
    toastMarkedOlderDays: "Marked articles older than {days} day(s) as read.",
    toastMarkedAllRead: "Marked all as read.",
    toastErrMarkAllRead: "Failed to mark all as read.",
    toastRefreshedFeed: 'Refreshed "{title}".',
    toastRefreshedAll: "Requested Miniflux to refresh all feeds.",
    toastErrRefresh: "Could not refresh feeds.",
    toastCopied: "Copied {label}.",
    toastCopiedImg: "Copied image to clipboard!",
    toastErrCopy: "Clipboard write blocked by browser.",
    toastErrCopyImg: "Could not copy image directly; try downloading ZIP.",
    toastSelectedAllMax:
      "Selected all matching filter (up to 200 articles for ZIP export).",
    toastSelectedAll: "Selected all {count} articles.",
    toastExportedZip: "Exported ZIP successfully!",
    toastErrZip: "Failed to export ZIP.",
    toastCopiedAllMd: "Copied {count} articles as one Markdown document!",
    toastErrCopyMd: "Failed to copy bulk Markdown.",
    toastCreatedFolder: 'Created folder "{title}".',
    toastErrCreateFolder: "Could not create folder.",
    toastRenamedFeed: 'Renamed feed to "{title}".',
    toastErrRenameFeed: "Could not rename feed.",
    toastMovedFeed: 'Moved "{title}" to new folder.',
    toastErrMoveFeed: "Could not move folder.",
    toastUnfollowed: 'Unsubscribed from "{title}".',
    toastErrUnfollow: "Could not unsubscribe feed.",
    toastSetStartPage: 'Set "{title}" as default start page.',
    toastTagUpdated: "Updated tags.",
    toastTagErr: "Could not update tags.",
    toastBulkTagged: 'Applied tag "{tag}" to {count} article(s).',

    // FeedModals
    modalProperties: "Properties",
    modalFilter: "Keyword Filters",
    modalLoading: "Loading details...",
    modalDisplayName: "Display name",
    modalFolder: "Folder",
    modalFeedUrl: "Feed URL",
    modalSiteUrl: "Site URL",
    modalCrawler: "Auto-fetch full text (Crawler)",
    modalEnabled: "Enabled",
    modalErrorsCount: "Errors ({count}x):",
    modalUnknownErr: "Unknown error",
    modalFilterDesc:
      "Uses Miniflux Regex or keyword patterns (separate with `|`, case-insensitive with `(?i)keyword`).",
    modalKeeplist: "Keep only articles matching (Keeplist rules)",
    modalBlocklist: "Block articles matching (Blocklist rules)",
    modalRescanNow: "Refresh now",
    modalSavedFeed: "Saved feed settings.",
    modalSaveFeedErr: "Failed to save feed settings.",
    modalRescanSent: 'Triggered refresh for "{title}".',

    // ContentManager (/manage)
    manageSubtitle: "Manage feeds, custom tags, and preferences",
    tabFeeds: "Feeds",
    tabFolders: "Folders",
    tabTags: "Tags",
    tabSettings: "Settings",
    addSourceShort: "Add source",
    postgresLabel: "Postgres:",
    activeEntriesAutoClean:
      "{count} stored articles · auto-delete after {days}d (except ★)",
    redisCacheLabel: "Redis Cache:",
    redisKeysSuffix: "{count} RSSHub keys",
    clearCache: "Clear cache",
    cleanOldEntries: "Clean old articles",
    allFeedsLabel: "All feeds",
    searchFeedsPlaceholder: "Search feeds...",
    allFoldersOpt: "All folders",
    allFeedTypesOpt: "All feed types",
    showCountPrefix: "Show:",
    sortSize: "Sort: Storage ↓",
    sortEntries: "Sort: Articles ↓",
    sortName: "Sort: Name A-Z",
    showUrl: "Show URLs",
    pillAll: "All",
    pillDisabled: "Disabled",
    pillFiltered: "Filtered",
    pillIssues: "Issues",
    selectedFeedsCount: "{count} feed(s) selected",
    moveToFolderOpt: "Move to folder...",
    totalFeedsCount: "Total: {count} feeds",
    colEnabled: "On",
    colFeed: "Feed",
    colStorage: "Storage",
    colReadRate: "Read rate",
    colChecked: "Checked",
    colLastPost: "Last post",
    colHealth: "Status",
    colActions: "Actions",
    loadingFeeds: "Loading feeds...",
    noMatchingFeeds: "No feeds match current filters.",
    filterBadge: "Filter",
    entriesSuffix: "entries",
    newFolderPlaceholder: "New folder name...",
    createFolderBtn: "Create folder",
    folderStats: "({feeds} feeds · {unread} unread)",
    cleanupModalTitle: "Clean old articles",
    cleanupScopePrefix: "Scope:",
    cleanupScopeNote: "Starred/Saved articles (★) are always preserved.",
    cleanupOlderThan: "Delete entries older than",
    cleanup180d: "Older than 180 days (6 months)",
    cleanup90d: "Older than 90 days (3 months)",
    cleanup30d: "Older than 30 days (1 month)",
    cleanup7d: "Older than 7 days",
    cleanup0d: "All read articles (any age)",
    cleanupIncludeUnread:
      "Include unread articles past age limit (still keeps ★ starred)",
    cleaning: "Cleaning...",
    confirmCleanup: "Confirm cleanup",

    // Tags Manager (/manage?tab=tags)
    tagsIntroTitle: "Manage Article Tags",
    tagsIntroDesc:
      "Create your own custom tags, pick colors, or rename them. Assign or remove tags manually on individual articles or in bulk to organize content your way.",
    createTagTitle: "Create or recolor Tag",
    tagNamePlaceholder: "e.g. Must Read, Ideas, AI, Business...",
    createTagBtn: "Save Tag",
    viewTagArticles: "View",
    tagStats: "{total} articles · {unread} unread",
    renameTagPrompt: "Rename tag:",
    confirmDeleteTag:
      'Delete tag "{name}" from all articles?',

    // Settings tab (/manage?tab=settings)
    settingsLanguageTitle: "Interface Language",
    settingsLanguageDesc:
      "Choose your preferred display language for the reader, tags, and settings.",
    langViDesc: "Full Vietnamese interface across all views.",
    langEnDesc: "Full English interface across reader, tags, and settings.",
    settingsAppearanceTitle: "Appearance & Storage",
    settingsThemeLabel: "Color theme",
    lightModeName: "Light",
    darkModeName: "Dark",
    settingsRetentionTitle: "Auto-Cleanup Policy",
    settingsRetentionDesc:
      "Non-starred read and unread articles are automatically pruned after {days} days.",

    // StatusDashboard
    statusBackBtn: "Back to reader",
    statusTitle: "System Status",
    statusRecheck: "Recheck",
    statusLoading: "Loading system status...",
    statusMinifluxFeeds: "Miniflux & Feeds",
    statusBrokenCount: "{count} feed(s) with errors",
    statusMinifluxLost: "Miniflux unreachable",
    statusXCookie: "X (Twitter) Cookie",
    statusXNone: "None added",
    statusXExpired: "Expired",
    statusXOk: "Healthy",
    statusXEmpty: "No X feeds configured in Miniflux",
    statusXSummary: "{broken}/{total} X feeds failing",
    statusBackupTitle: "Postgres Backup",
    statusBackupNone: "No backups found",
    statusBackupHint: "Run `make backup` to create a backup",
    statusApifyTitle: "Apify Spend This Month",
    statusApifyWarn:
      "⚠️ Over 80% of free monthly budget ($5/mo) used. Consider reducing resultsLimit or low-priority pages.",
    statusApifyMissing: "APIFY_TOKEN is not configured in .env.",
    statusBrokenSection: "Feeds with Errors ({count})",
    statusUpdatedAt: "Checked:",
    statusAllHealthy: "✓ All feeds are healthy.",
    statusErrorBadge: "{count} errors",

    // LoginPage
    loginSubtitle: "Self-hosted RSS reader",
    loginPasswordLabel: "Access password",
    loginPlaceholder: "Enter READER_UI_PASSWORD",
    loginBtn: "Sign in",
    loginChecking: "Verifying...",
    loginFailed: "Sign in failed.",
    loginConnErr: "Could not reach server.",
  },
} as const;

export type TranslationKey = keyof typeof DICTS.vi;

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "vi",
  setLocale: () => {},
  t: (key) => String(DICTS.vi[key] || key),
});

export function LanguageProvider({
  initialLocale = "vi",
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rss-lang");
      if (saved === "en" || saved === "vi") {
        setLocaleState(saved);
        document.documentElement.lang = saved;
        document.cookie = `rss-lang=${saved}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch {
      // ignore
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem("rss-lang", next);
      document.cookie = `rss-lang=${next}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = next;
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dict = DICTS[locale] || DICTS.vi;
      let text: string = dict[key] ?? DICTS.vi[key] ?? String(key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

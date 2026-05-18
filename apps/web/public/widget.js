(function () {
  if (window.__zutiWidgetInitialized) return;
  window.__zutiWidgetInitialized = true;

  // Extract widget key and bot name from script tag attributes
  var scriptEl = document.currentScript || document.querySelector('script[data-zuti-widget-key]');
  var widgetKey = scriptEl && scriptEl.getAttribute('data-zuti-widget-key');
  var botName = scriptEl && scriptEl.getAttribute('data-zuti-bot-name') || 'Support';
  // Derive API base from the script's own origin so the widget works when
  // embedded on external sites (window.location.origin would be the customer's domain)
  var scriptOrigin = scriptEl && scriptEl.src ? new URL(scriptEl.src).origin : window.location.origin;

  var root = document.createElement('div');
  root.id = 'zuti-widget-root';
  root.style.position = 'fixed';
  root.style.right = '20px';
  root.style.bottom = '20px';
  root.style.zIndex = '2147483647';
  root.style.fontFamily = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  var containerWrapper = document.createElement('div');
  containerWrapper.style.display = 'flex';
  containerWrapper.style.flexDirection = 'column';
  containerWrapper.style.gap = '16px';
  containerWrapper.style.alignItems = 'flex-end';

  var panel = document.createElement('div');
  panel.style.width = '340px';
  panel.style.maxWidth = 'calc(100vw - 24px)';
  panel.style.height = '460px';
  panel.style.maxHeight = 'calc(100vh - 96px)';
  panel.style.display = 'none';
  panel.style.flexDirection = 'column';
  panel.style.overflow = 'hidden';
  panel.style.border = '1px solid #27272a';
  panel.style.borderRadius = '12px';
  panel.style.background = '#09090b';
  panel.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';

  var header = document.createElement('div');
  header.style.padding = '14px 16px';
  header.style.borderBottom = '1px solid #27272a';
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.background = 'linear-gradient(135deg, #0f172a 0%, #0c0f1a 100%)';

  var headerContent = document.createElement('div');
  headerContent.style.flex = '1';
  headerContent.style.display = 'flex';
  headerContent.style.alignItems = 'center';
  headerContent.style.gap = '10px';

  // Chat icon SVG (cleaner than leaf)
  var chatIcon = document.createElement('span');
  chatIcon.style.display = 'flex';
  chatIcon.style.alignItems = 'center';
  chatIcon.style.justifyContent = 'center';
  chatIcon.style.flexShrink = '0';
  chatIcon.style.color = '#bfdbfe';
  chatIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  var titleContainer = document.createElement('div');
  titleContainer.style.display = 'flex';
  titleContainer.style.flexDirection = 'column';
  titleContainer.style.gap = '2px';
  titleContainer.style.minWidth = '0';

  var title = document.createElement('div');
  title.textContent = botName;
  title.style.color = '#ffffff';
  title.style.fontSize = '14px';
  title.style.fontWeight = '600';
  title.style.lineHeight = '1';

  var subtitle = document.createElement('div');
  subtitle.style.display = 'flex';
  subtitle.style.alignItems = 'center';
  subtitle.style.color = '#a1a1aa';
  subtitle.style.fontSize = '11px';
  subtitle.style.fontWeight = '400';
  subtitle.style.lineHeight = '1';
  subtitle.textContent = 'Powered by Zuti';

  titleContainer.appendChild(title);
  titleContainer.appendChild(subtitle);
  headerContent.appendChild(chatIcon);
  headerContent.appendChild(titleContainer);

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = '#a1a1aa';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '24px';
  closeBtn.style.lineHeight = '1';
  closeBtn.style.padding = '0';
  closeBtn.style.width = '24px';
  closeBtn.style.height = '24px';
  closeBtn.style.display = 'flex';
  closeBtn.style.alignItems = 'center';
  closeBtn.style.justifyContent = 'center';
  closeBtn.style.flexShrink = '0';
  closeBtn.style.transition = 'color 0.2s';

  closeBtn.addEventListener('mouseenter', function() {
    closeBtn.style.color = '#ffffff';
  });
  closeBtn.addEventListener('mouseleave', function() {
    closeBtn.style.color = '#a1a1aa';
  });

  header.appendChild(headerContent);
  header.appendChild(closeBtn);

  var messages = document.createElement('div');
  messages.style.flex = '1';
  messages.style.padding = '12px';
  messages.style.overflowY = 'auto';
  messages.style.display = 'flex';
  messages.style.flexDirection = 'column';
  messages.style.gap = '10px';
  messages.style.background = '#09090b';

  var disclaimer = document.createElement('div');
  disclaimer.style.marginTop = 'auto';
  disclaimer.style.paddingTop = '8px';
  disclaimer.style.borderTop = '1px solid #27272a';
  disclaimer.style.fontSize = '11px';
  disclaimer.style.color = '#71717a';
  disclaimer.style.lineHeight = '1.4';
  disclaimer.innerHTML = '💡 AI responses can occasionally be inaccurate. Please verify important details.';
  disclaimer.style.display = 'none'; // Will show after first bot message

  function addMessage(text, who) {
    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = who === 'user' ? 'flex-end' : 'flex-start';
    row.style.animation = 'slideIn 0.3s ease-out';

    var bubble = document.createElement('div');
    bubble.textContent = text;
    bubble.style.maxWidth = '85%';
    bubble.style.whiteSpace = 'pre-wrap';
    bubble.style.wordBreak = 'break-word';
    bubble.style.padding = '10px 12px';
    bubble.style.borderRadius = '12px';
    bubble.style.fontSize = '13px';
    bubble.style.lineHeight = '1.4';
    bubble.style.fontWeight = '400';

    if (who === 'user') {
      bubble.style.background = '#2563eb';
      bubble.style.color = '#ffffff';
    } else {
      bubble.style.background = '#18181b';
      bubble.style.color = '#e4e4e7';
      bubble.style.border = '1px solid #27272a';
      
      // Show disclaimer after first bot message
      if (disclaimer.style.display === 'none') {
        setTimeout(function() {
          disclaimer.style.display = 'block';
        }, 500);
      }
    }

    row.appendChild(bubble);
    // Always append before disclaimer if it exists
    if (disclaimer.parentNode === messages) {
      messages.insertBefore(row, disclaimer);
    } else {
      messages.appendChild(row);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  // Add slideIn animation
  if (!document.querySelector('style[data-zuti-widget-styles]')) {
    var style = document.createElement('style');
    style.setAttribute('data-zuti-widget-styles', 'true');
    style.textContent = '@keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }';
    document.head.appendChild(style);
  }

  addMessage('Hi! 👋 How can we help you today?', 'bot');

  messages.appendChild(disclaimer);

  var composer = document.createElement('form');
  composer.style.display = 'flex';
  composer.style.gap = '8px';
  composer.style.padding = '12px';
  composer.style.borderTop = '1px solid #27272a';
  composer.style.background = '#09090b';
  composer.style.alignItems = 'center';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Message...';
  input.style.flex = '1';
  input.style.border = '1px solid #27272a';
  input.style.background = '#111827';
  input.style.color = '#ffffff';
  input.style.borderRadius = '8px';
  input.style.padding = '9px 12px';
  input.style.fontSize = '13px';
  input.style.outline = 'none';
  input.style.transition = 'border-color 0.2s, box-shadow 0.2s';
  input.style.placeholderColor = '#71717a';

  input.addEventListener('focus', function() {
    input.style.borderColor = '#bfdbfe';
    input.style.boxShadow = '0 0 0 2px rgba(191, 219, 254, 0.1)';
  });

  input.addEventListener('blur', function() {
    input.style.borderColor = '#27272a';
    input.style.boxShadow = 'none';
  });

  var sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.style.border = 'none';
  sendBtn.style.background = 'transparent';
  sendBtn.style.color = '#bfdbfe';
  sendBtn.style.cursor = 'pointer';
  sendBtn.style.padding = '6px';
  sendBtn.style.display = 'flex';
  sendBtn.style.alignItems = 'center';
  sendBtn.style.justifyContent = 'center';
  sendBtn.style.transition = 'opacity 0.2s, color 0.2s';
  sendBtn.style.flexShrink = '0';

  // Send icon using Lucide-style arrow
  sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

  sendBtn.addEventListener('mouseenter', function() {
    sendBtn.style.color = '#ffffff';
    sendBtn.style.opacity = '1';
  });

  sendBtn.addEventListener('mouseleave', function() {
    sendBtn.style.color = '#bfdbfe';
  });

  sendBtn.disabled = false;

  composer.appendChild(input);
  composer.appendChild(sendBtn);

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.6';
    sendBtn.style.cursor = 'default';

    // Get or generate visitor ID
    var visitId = localStorage.getItem('zuti_visitor_id');
    if (!visitId) {
      visitId = 'visitor_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('zuti_visitor_id', visitId);
    }

    // Send message to backend via the script's own origin (works for external embeds)
    var apiPath = scriptOrigin + '/api/bots/widget/message/' + widgetKey;
    fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        visitorId: visitId,
      }),
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.message) {
          addMessage(data.message, 'bot');
        } else {
          addMessage('Sorry, I could not process that. Please try again.', 'bot');
        }
      })
      .catch(function(err) {
        console.error('Widget API error:', err);
        addMessage('Sorry, I could not connect to the server. Please try again.', 'bot');
      })
      .finally(function() {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        input.focus();
      });
  });

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(composer);

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.style.position = 'relative';
  launcher.style.zIndex = '1';
  launcher.style.width = '56px';
  launcher.style.height = '56px';
  launcher.style.borderRadius = '999px';
  launcher.style.border = 'none';
  launcher.style.cursor = 'pointer';
  launcher.style.background = 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)';
  launcher.style.color = '#ffffff';
  launcher.style.fontSize = '12px';
  launcher.style.fontWeight = '600';
  launcher.style.boxShadow = '0 8px 24px rgba(37, 99, 235, 0.4)';
  launcher.style.display = 'flex';
  launcher.style.alignItems = 'center';
  launcher.style.justifyContent = 'center';
  launcher.style.transition = 'all 0.3s ease';
  launcher.style.flexShrink = '0';

  var launcherIcon = document.createElement('span');
  launcherIcon.style.display = 'flex';
  launcherIcon.style.alignItems = 'center';
  launcherIcon.style.justifyContent = 'center';
  launcherIcon.style.color = '#ffffff';
  launcherIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  launcher.appendChild(launcherIcon);

  launcher.addEventListener('mouseenter', function() {
    launcher.style.transform = 'scale(1.05)';
    launcher.style.boxShadow = '0 12px 32px rgba(37, 99, 235, 0.5)';
  });

  launcher.addEventListener('mouseleave', function() {
    launcher.style.transform = 'scale(1)';
    launcher.style.boxShadow = '0 8px 24px rgba(37, 99, 235, 0.4)';
  });

  function setOpen(open) {
    if (open) {
      panel.style.display = 'flex';
      launcherIcon.style.opacity = '0';
      launcherIcon.style.display = 'none';
      input.focus();
    } else {
      panel.style.display = 'none';
      launcherIcon.style.display = 'flex';
      launcherIcon.style.opacity = '1';
    }
  }

  launcher.addEventListener('click', function () {
    setOpen(panel.style.display !== 'flex');
  });

  closeBtn.addEventListener('click', function () {
    setOpen(false);
  });

  containerWrapper.appendChild(panel);
  containerWrapper.appendChild(launcher);
  root.appendChild(containerWrapper);
  document.body.appendChild(root);
})();

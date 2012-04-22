/**
 * The WoW Stat App code
 * 
 * @author:		Devin Smith
 * @date:		2012-04-12
 * 
 */

var Ti = Titanium;
var App = {
	mainWindow: Ti.UI.getMainWindow(),
	prefs: [],
	serverStatus: null,
	worker:{}
};
var Defaults = {
	'region': 'us',
	'server': null,
	'notify-time-up': 15*60,
	'notify-time-down': 5,
	'check-up': 5*1000*60,
	'check-down': .5*1000*60,
	'notify-up-action': 'notify',
	'notify-down-action': 'notify',
	'startup-load': true,
	'automatic-check': true,
	'startup-show-window': true,
	'serial': null,
	'wow-path': Ti.platform == 'win32' ? 'C:\\Program Files\\World of Warcraft\\WoW.exe' : '/Applications/World of Warcraft/WoW.app'
};
var TimeRange = [.25,.5,1,1.5,2,3,4,5,6,7,8,9,10,15,20,30,60];
var NotifyRange = [5,15,30,45,60,60*2,60*5,60*15,60*30,60*60];
var TableName = 'prefs';

// download units
var BINARY_UNITS = [1024, 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yo'];
var SI_UNITS = [1000, 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];


// clear the db and reload the defaults
App.clearDb = function() {
	
	App.dbConnect();
	App.db.execute('DROP TABLE prefs;');
	App.dbDisconnect();

	App.serverStatus = null;
	Defaults.serial = App.prefs.serial;

	for (x in Defaults) {
		App.prefs[x] = Defaults[x];
	}
	App.prefs['server'] = App.realms[0];
	App.prepareDb();
	App.loadPrefs();
};

// prepare the db for connectivity
App.prepareDb = function() {
	App.dbConnect();

	var res = App.db.execute('SELECT name FROM sqlite_master WHERE type="table" AND name="'+ TableName +'";');
	var dbExists = false;
	while (res.isValidRow()) {
		var dbExists = true;
		res.next();
	}
	
	for (x in Defaults) {
		App.prefs[x] = Defaults[x];
	}
	
	if (dbExists) {
		var dbprefs = App.db.execute('SELECT * FROM '+ TableName +';');
		while (dbprefs.isValidRow()) {
			App.prefs[dbprefs.fieldByName('key')] = App.sterilizePref(dbprefs.fieldByName('value'));
			dbprefs.next();
		}
		
		for (x in Defaults) {
			if (typeof App.prefs[x] === 'undefined') {
				App.db.execute('INSERT INTO ' + TableName + ' (`key`,value) VALUES("'+ x +'","' + Defaults[x] + '");');
			}
		}
	} else {
		App.db.execute('CREATE TABLE IF NOT EXISTS prefs(`key` TEXT PRIMARY KEY, `value` TEXT);');

		for (x in Defaults) {
			App.db.execute('INSERT INTO ' + TableName + ' (`key`,value) VALUES("'+ x +'","' + Defaults[x] + '");');
		}
	}
	
	App.dbDisconnect();
};

// connect to the database
App.dbConnect = function() {
	if (!App.db) {
		App.db = Ti.Database.open('wowstat');
	}
};

// disconnect from the db
App.dbDisconnect = function() {
	App.db.close();
	App.db = false;
};

// start or restart timers
App.timers = function() {
	if (App.timer) {
		clearInterval(App.timer);
	}
	App.timer = setInterval(App.check, App.prefs[App.serverStatus ? 'check-up' : 'check-down']);
	
	if (App.versionTimer) {
		clearInterval(App.versionTimer);
	}
	// check every day, but dont bring to front in case there playing wow
	App.versionTimer = setInterval(function() {
		App.versionCheck(false, false);
	}, 60*60*1000*24);
};

// get a color by realm status
App.getColor = function(status) {
	var label = status.name,
		color = 'blue';
	if (!status.status) {
		color = 'red';
		label += ' is down!';
	} else {
		label += ' is up with ' + status.population + ' pop';
		switch (status.population) {
			case 'high':
				color = 'orange';
				break;
			case 'medium':
				color = 'yellow';
				break;
			case 'low':
			default:
				color = 'green';
				break;
		}
	}
	return {color: color, label: label};
}

// triggered after a check
App.checkComplete = function(json) {
	var server = json.realms ? json.realms[0] : json,
		color,
		label;

	if (App._debug) {
		if (server.slug == 'tichondrius') {
			server.status = false;
		}
	}
	
	if (App.serverStatus != null && App.serverStatus != server.status) {
		App.notifyAction(server);
	}
	var byStatus = App.getColor(server);
	color = byStatus.color;
	label = byStatus.label; 
	
	//$('.wrapper').css('background-image','url(/img/bg-' + color + '.png)');
	App.tray.setIcon('/img/tray-icon-' + color + '-'+ App.platform +'.png');
	Ti.UI.setDockIcon('/img/icon-' + color + '.png');
	App.trayStatus.setLabel(label);
	$('.server-status-icon').css('background-image','url(/img/tray-status-icon-' + color + '-osx.png)');

	App.serverStatus = server.status;
};

// check to see if the server is up
App.check = function() {
	if (!App.prefs.server) return;
	if (!App.serverStatus && App.realms) {
		for (x in App.realms) {
			if (App.realms[x].slug == App.prefs.server) {
				App.checkComplete(App.realms[x]);
				break;
			}
		}
	}
	App.request('http://'+ App.prefs['region'].toLowerCase() +'.battle.net/api/wow/realm/status?realm=' + App.prefs['server'],App.checkComplete);
};

// notify the user by their prefered action
App.notifyAction = function(realm) {
	realm = realm || App.realm(App.prefs.server);
	if (realm.status) {
		App.notify({
			title: realm.name + ' is up!',
			message: realm.name + ' is back up! Click here to launch WoW.',
			timeout: App.prefs['notify-time-up'],
			color: 'green',
			callback: App.launch
		});
	} else {
		App.notify({
			title: realm.name + ' is down!',
			message: realm.name + ' has gone down. You will be notified again when it is back up.',
			timeout: App.prefs['notify-time-down'],
			color: 'red'
		});
	}
};

// throw a notification
App.notify = function(params) {
	var notice = Ti.Notification.createNotification(window);
	notice.setTitle(params.title);
	notice.setMessage(params.message);
	 // @bug this doesnt seem to work with growl 1.2.2 on osx. always defaults to 5 seconds
	notice.setTimeout(params.timeout || 5);
	if (params.callback) {
		notice.setCallback(params.callback);
	}
	if (params.color) {
		notice.setIcon('/img/icon-' + params.color + '.png');
	}
	notice.show();
};

// get the realms info. only needed when a status changes
App.realm = function(realm) {
	for (x in App.realms) {
		if (App.realms[x].slug == realm) {
			return App.realms[x]; 
		}
	}
	return null;
};

// read the prefs from dom and store them
App.readPrefs = function() {
	var prefs = {};
	$('select, input:radio:checked, input:text').each(function() {
		prefs[$(this).attr('name')] = $(this).val();
	});
	$('input:checkbox').each(function(){
		prefs[$(this).attr('name')] = $(this).attr('checked') ? true : false;
	});
	App.preferences(prefs);
};

// load the prefs to the form
App.loadPrefs = function() {
	for (x in App.prefs) {
		var el = $('[name="'+ x +'"]');
		if (el.length > 1) {
			// radio
			$('input:radio[name="'+ x +'"][value="'+ App.prefs[x] +'"]').attr('checked', true);
		} else if (el.attr('type') == 'checkbox') {
			// checkbox
			el.attr('checked',App.prefs[x]);
		} else {
			// select or regular input
			el.val(App.prefs[x]);
		}
	}
};

// update prefs
App.preferences = function(prefs) {
	if (prefs) {
		// save prefs
		App.dbConnect();
		if (prefs.server != App.prefs.server) {
			var check = true;
		} else {
			var check = false;
		}
		var prefRegion = App.prefs.region;
		App.prefs = prefs;
		App.sterilizePrefs();
		
		if (prefs.region != prefRegion) {
			App.getRealms();
			App.prefs.server = App.realms[0].slug;
			check = true;
		}

		for (x in App.prefs) {
			App.db.execute('UPDATE prefs SET value="'+ App.prefs[x] +'" WHERE `key`="'+ x +'";');
		}

		App.dbDisconnect();
		if (check) {
			App.serverStatus = null;
			App.check();
		}
		App.timers();
		
		Ti.Analytics.settingsEvent('preferences', App.prefs);
	}
	return App.prefs;	
};

// convert all prefs
App.sterilizePrefs = function() {
	for (x in App.prefs) {
		App.prefs[x] = App.sterilizePref(App.prefs[x]); 
	}
};

// convert data types
App.sterilizePref = function(pref) {
	if (pref == "false") pref = false;
	else if (pref == "true") pref = true;
	else if (pref == "null") pref = null;
	else if (pref == parseInt(pref)) pref = parseInt(pref);
	return pref;
};

// request a remote uri
App.request = function(url, complete) {
	var client = Ti.Network.createHTTPClient();
	client.open("GET", url, false);
	client.send();
	complete($.parseJSON(client.responseText),client.responseText);
};

// change the server
App.changeServer = function(e) {
	var server = e.getTarget().server;
	$('select[name="server"]').val(server.slug);
	App.readPrefs();
};

// get the realms and add them to the realm list
App.getRealms = function() {
	var url = 'http://'+ App.prefs['region'].toLowerCase() +'.battle.net/api/wow/realm/status';
	console.log(url);
	App.request(url,function(json) {
		if (App._debug) {
			for (var x in json.realms) {
				if (json.realms[x].slug == 'tichondrius') {
					json.realms[x].status = false;
				}
			}
		}
		
		
		App.realms = json.realms;
		$('select[name="server"] option').remove();
		
		var trayServersMenu = Ti.UI.createMenu();
		App.trayServers.setSubmenu(trayServersMenu);

		for (var x in App.realms) {
			$('select[name="server"]').append($('<option></option>')
				.attr('value',App.realms[x].slug)
				.text(App.realms[x].name));

			var color = App.getColor(App.realms[x]);

			var i = Ti.UI.createMenuItem(App.realms[x].name, App.changeServer);
			i.server = App.realms[x];
			i.setIcon('/img/tray-status-icon-'+ color.color +'-osx.png');
			trayServersMenu.appendItem(i);
		}
		if (!App.prefs.server) {
			App.prefs.server = App.realms[0];
		}
	});
};

// launch wow
App.launch = function() {
	Titanium.Platform.openApplication(App.prefs['wow-path']);
};

// prepare the main window height
App.prepareChrome = function() {
	if (Titanium.platform == 'win32') {
		App.mainWindow.height = App.mainWindow.height + 55;
	} 
};

// prepare the tray menu
App.prepareTray = function() {
	App.tray = Ti.UI.addTray('/img/tray-icon-blue-'+ App.platform +'.png');
	App.tray.setHint('WoW Stat');
	var trayMenu = Ti.UI.createMenu();
	App.tray.setMenu(trayMenu);
	
	trayMenu.appendItem(Ti.UI.createMenuItem("WoW Stat",function() {
		App.mainWindow.show();
		App.mainWindow.unminimize();
	}));
	trayMenu.addSeparatorItem();

	App.trayStatus = Ti.UI.createMenuItem("Server Status Unavailable");
	trayMenu.appendItem(App.trayStatus);
	
	App.trayServers = Ti.UI.createMenuItem("Change Servers");
	trayMenu.appendItem(App.trayServers);
	
	trayMenu.appendItem(Ti.UI.createMenuItem("Recheck Server", function(){
		App.check();
	}));
	trayMenu.appendItem(Ti.UI.createMenuItem("Launch WoW", function(){
		App.launch();
	}));
	trayMenu.addSeparatorItem();
	trayMenu.appendItem(Ti.UI.createMenuItem("Check for Updates", function(){
		App.versionCheck(true, true);
	}));
	trayMenu.appendItem(Ti.UI.createMenuItem("Hide", function(){
		App.mainWindow.hide();
	}));
	trayMenu.appendItem(Ti.UI.createMenuItem("Show", function(){
		App.mainWindow.show();
	}));
	trayMenu.appendItem(Ti.UI.createMenuItem("Quit", function(){
		Ti.App.exit();
	}));
};

// show or hide the window
App.prepareWindow = function() {
	if (App.prefs['startup-show-window']) {
		App.mainWindow.show();
	}
};

// prepare the ui for viewing
App.prepareUI = function() {
	App.prepareChrome();
	App.prepareWindow();
	App.prepareTray();
	App.registered();

	var menu = Ti.UI.createMenu();
	var file = Ti.UI.createMenuItem("File");
	//var view = Ti.UI.createMenuItem("View");
	
	menu.appendItem(file);
	//menu.appendItem(view);

	file.addItem("Clear Preferences", function(e) {
	    App.clearDb();
		App.loadPrefs();
	});
	file.addItem("Check for Updates", function(e) {
	    App.versionCheck(true, true);
	});
	file.addItem("Install Growl", function(e) {
	    App.downloadGrowl();
	});
	
	if (Ti.platform == 'win32') {
		file.addSeparatorItem();
		file.addItem("Hide", function(e) {
			App.mainWindow.hide();
		});
		file.addItem("Quit", function(e) {
			Ti.App.exit();
		});
	}

	Ti.UI.setMenu(menu);

	$('select[name="check-up"], select[name="check-down"]').each(function() {
		for (x in TimeRange) {
			$(this).append($('<option></option>')
				.attr('value',TimeRange[x]*1000*60)
				.text(TimeRange[x] + ' minutes')); 
		}
	});
};

// set autoload
App.autoload = function(load) {
	// Windows startup shortcut 
	if (Ti.platform == 'win32') {
	 
		// Used by the windows commands to get the startup folder location
		var startupRegKeyWin = ["C:\\Windows\\System32\\cmd.exe", "/C", "REG", "QUERY", "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "/v", "Startup", "|findstr", "/i", "REG_SZ"];
	 
		// Set out app exe path and the shortcut path         
		var appPathExe = Titanium.Filesystem.getApplicationDirectory()+'\\'+Titanium.App.getName()+'.exe';
		var regString = null;
		 
		// Set the process
		var process = Titanium.Process.createProcess(startupRegKeyWin);
	 
		process.setOnReadLine(function(data) {
			// Get the string from the registry that contains out startup folder path
			regString = data.toString().split('REG_SZ');
			// Split the string on REG_SZ, this will leave our startup folder path - trim the string to remove any unecessary white space 
			// .trim() is a Mootools method, if your using jQuery, use $.trim(regString[1]) instead
			var startupFolderPath = regString[1].trim();
			// An extra check to make sure this is the reg key with the Startup folder
			if (startupFolderPath.test('Startup')) {
				// Create the shortcut in the startup folder now that we have the path
				var appPathShortcut = startupFolderPath+'\\'+Titanium.App.getName()+'.lnk';
				var file = Titanium.Filesystem.getFile(appPathExe);
				file.createShortcut(appPathShortcut);
			}
		});

		// Fire the process to find the reg key
		process.launch();
	} else if (Ti.platform == 'osx') {
		// @todo : this doesnt work!
	
		/*
			var appPath = Titanium.App.getPath().split('WoW Stat');
			//alert(Titanium.App.getPath());
			//alert(appPath);
			appPath = appPath[0] + 'WoW Stat.app';
		
		//	var contents = Titanium.App.getPath().split('MacOS');
		
		//	var path = contents[0].replace(/ /g,'\ ');
		//	var process = Ti.Process.createProcess([path]);
		
			Ti.Platform.openApplication('/usr/bin/defaults write ~/Library/Preferences/loginwindow AutoLaunchedApplicationDictionary -array-add \'{ "Path" = "/Applications/TextEdit.app"; "Hide" = 0; }\'');
			//Ti.Platform.openApplication("/usr/bin/defaults write ~/Library/Preferences/loginwindow AutoLaunchedApplicationDictionary -array-add \"<dict><key>Path</key><string>" + appPath + "</string></dict>\"");
		*/
	}
};

// add event handlers to dom
App.addEvents = function() {
	$('select, input').change(App.readPrefs);
	$('#browse').click(function() {
		var props = {multiple:false,directories:false,files:true,types:['exe','app','bin','bat','sh']};
		Ti.UI.openFileChooserDialog(function(f) {
			$('input[name="wow-path"]').val(f[0]);
			App.readPrefs();
		},props);
	});
	
	$('input[name="wow-path"]').get(0).addEventListener("drop", function(e) {
		App.readPrefs();
	}, false);
	$('input[name="wow-path"]').get(0).addEventListener("dragover", function(e) {
		$('input[name="wow-path"]').val('');
	}, false);

	$('.devin').click(function() {
		Ti.Platform.openURL('http://devin.la');
	});
	
	$('#register').click(function() {
		App.register($('input[name="email"]').val());
	});
	$('input[name="email"]').keydown(function(e) {
		if (e.which == 13) {
			$('#register').click();
		}
	});
};

// hides if already registered
App.registered = function() {
	if (App.prefs['serial']) {
		$('.registration').hide();
	}
	if (App.prefs['serial']) {
		App.mainWindow.height = App.mainWindow.height - 95;
	}
};

// register
App.register = function(email) {
	if (!email) {
		return;
	}
	App.request('http://wow-stat.net/register?email=' + Ti.platform,function(json) {
		if (json.status && json.key) {
			App.prefs['serial'] = json.key;
			App.preferences(App.prefs);
			App.registered();
			alert('Thank you for registering!');
		} else {
			alert('Failed to register! Dont worry! You can always register later!');
		}
	});
};

// triggered when the app is finished loading
App.complete = function() {
	$('#loading-overlay').hide();
};

// safe platform name
App.setPlatform = function() {
	switch (Ti.platform) {
		case 'win32':
		case 'win64':
		case 'win':
			App.platform = 'win';
			break;
		case 'osx':
		default:
			App.platform = 'osx';
			break;
	}
};

// check version from website
App.versionCheck = function(front, manual) {
	App.request('http://wow-stat.net/version/' + Ti.platform,function(json) {
		if (!json.version) {
			alert('There was a problem checking the version. Try visiting http://wow-stat.net');
		} else {
			var v = [json.version,Ti.App.version].sort().reverse();
			if (Ti.App.version != v[0]) {
				if (front) {
					App.mainWindow.show();
					App.mainWindow.unminimize();
				}
				console.log('Current: ' + Ti.App.version,'New: ' + json.version);
				if (confirm('There is a newer version available ('+ json.version +'). Do you wish to download and install it now? WoW Stat will be closed if you click OK.')) {
					App.downloadUpdate(json['html_url'], json['filename']);
				}
			} else {
				if (manual) {
					alert('Your are currently using the latest version: '+ Ti.App.version);
				}
			}
		}
	});
};

// convert units
App.unitify = function(n, units) {
    for (var i = units.length; i-->1;) {
        var unit = Math.pow(units[0], i);
        if (n >= unit) {
			var result = n / unit; 
			return result.toFixed(2) + units[i];
		}
    }
	return n;	
};

// create and launch the download window
App.prepareDownloadWindow = function() {
	App.downloadWindow = Ti.UI.createWindow({
		id: 'download',
		url: 'app://download.html',
		width: 300,
		height: 100,
		maximizable: false,
		minimizable: true,
		closeable: true,
		resizable: true,
		fullscreen: false,
		maximized: false,
		minimized: false,
		usingChrome: true,
		topMost: false,
		visible: true
	});
	App.downloadWindow.open();

	App.downloadWindow.addEventListener('close',function() {
		App.updateWorker.terminate();
	});
};

// update the app
App.downloadUpdate = function(url, filename, size) {
	App.download({
		url: url,
		filename: filename,
		id: 'update',
		title: 'Update',
		size: size,
		complete: function(worker, file) {
			Ti.Platform.openApplication(file);
			Ti.App.exit();
		}
	});
};

// download and install growl
App.downloadGrowl = function() {
	App.download({
		url: 'http://growl.googlecode.com/files/Growl-1.2.2.dmg',
		filename: 'Growl-1.2.2.dmg',
		id: 'growl',
		title: 'Growl',
		size: 7271722,
		complete: function(worker, file) {
			Ti.Platform.openApplication(file);
		}
	});
};

//start a file download
App.download = function(params) {

	if (App.worker[params.id]) {
		return;
	}
	
	var downloadWindow = Titanium.UI.createWindow({
		id: 'download',
		url: 'app://download.html',
		width: 300,
		height: 110,
		maximizable: false,
		minimizable: true,
		closeable: true,
		resizable: true,
		fullscreen: false,
		maximized: false,
		minimized: false,
		usingChrome: true,
		topMost: false,
		visible: true
	});
	downloadWindow.open();
	var $d, aborted = false;
	
	downloadWindow.on('page.init',function() {
		downloadWindow.getDOMWindow().window.onload = function() {
			$d = downloadWindow.getDOMWindow().jQuery;
			downloadWindow.getDOMWindow().title += ' ' + params.title;	

			$d('#cancel').click(function() {
				aborted = true;
				App.worker[params.id].postMessage({event: 'abort'});
			});
		};
	});
	

	downloadWindow.addEventListener('close',function() {
		aborted = true;
		App.worker[params.id].postMessage({event: 'abort'});
		downloadWindow = null
	});
	
	var dlbytes = 0;

	App.worker[params.id] = Ti.Worker.createWorker('/js/download.js');
	App.worker[params.id].postMessage({
		event: 'start',
		url: params.url,
		filename: params.filename,
		dir: Ti.Filesystem.getDesktopDirectory().toString() + Ti.Filesystem.getSeparator()
	});
 
	App.worker[params.id].onmessage = function(event) {
		var newdl = parseInt(event.message);
		if (newdl == 0) {
			dlbytes = 0;

		} else if (newdl == -1) {
			alert('Download failed');
			dlbytes = 0;
			App.worker[params.id].terminate();
			App.worker[params.id] = null;

		} else if (newdl == -2) {
			if (params.complete && !aborted) {
				params.complete(App.worker[params.id],Ti.Filesystem.getDesktopDirectory().toString() + Ti.Filesystem.getSeparator() + params.filename);
			}
			if (downloadWindow) {
				downloadWindow.close();
			}
			App.worker[params.id].terminate();
			App.worker[params.id] = null;

		} else if (newdl == -3) {
			alert('Download canceled');
			App.worker[params.id].terminate();
			App.worker[params.id] = null;

		} else {
			dlbytes += newdl;
		}
		
		if (downloadWindow && $d) {
			if (params.size) {
				var pos = Math.round($d('#progress').width() * dlbytes/params.size);
				console.log(pos);

				$d('#bar').stop().animate({ width: pos});
			}
			$d('#downloaded').text(App.unitify(dlbytes,SI_UNITS));

		}
	};

	App.worker[params.id].start();
};

// initilize db, prefs, and ui
App.main = function() {
	App.setPlatform();
	App.prepareDb();
	App.prepareUI();
	App.getRealms();
	App.loadPrefs();
	App.check();
	App.timers();
	App.addEvents();
	App.complete();
	if (App.prefs['automatic-check']) {
		setTimeout(function() {
			App.versionCheck(true, false);
		},500);
	};
	console.log(App.mainWindow);
};

$(document).ready(function() {	
	App.main();
});
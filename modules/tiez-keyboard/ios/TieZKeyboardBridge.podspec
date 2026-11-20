Pod::Spec.new do |s|
  s.name = 'TieZKeyboardBridge'
  s.version = '1.0.0'
  s.summary = 'TieZ clipboard keyboard bridge'
  s.description = 'Shares recent synced clipboard text with the TieZ keyboard extension.'
  s.license = 'GPL-3.0-only'
  s.author = 'TieZ'
  s.homepage = 'https://github.com/jimuzhe/tiez-mobile'
  s.platform = :ios, '15.1'
  s.source = { :git => 'https://github.com/jimuzhe/tiez-mobile.git' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

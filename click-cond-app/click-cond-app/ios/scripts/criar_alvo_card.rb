# Cria no Runner.xcodeproj o alvo da extensão "CardPortaria" (Live Activity do
# card ao vivo da portaria remota) e liga os arquivos Swift compartilhados ao
# app. Roda no CI (ios-release.yml), antes do CocoaPods.
#
# Por que um script e não o pbxproj editado à mão: não há Mac. Editar o
# pbxproj sem Xcode é frágil (ids, fases de build, referências cruzadas); o
# gem xcodeproj — o mesmo que o CocoaPods e o fastlane usam — faz isso com a
# estrutura certa. É IDEMPOTENTE: com o alvo já presente, não faz nada.
#
# Uso (em click-cond-app/click-cond-app/ios): bundle exec ruby scripts/criar_alvo_card.rb

require "xcodeproj"

IOS = File.expand_path("..", __dir__)
PROJETO = File.join(IOS, "Runner.xcodeproj")
ALVO = "CardPortaria"
BUNDLE = "br.com.clickprestare.app.CardPortaria"
TEAM = "9FD7V97G5V"

# Compilados no app E na extensão (o iOS casa a Live Activity pelo nome do
# tipo, e os botões rodam no processo do app).
COMPARTILHADOS = %w[CardPortariaAttributes.swift CardIntents.swift].freeze
SO_EXTENSAO = %w[CardPortariaWidget.swift CardVisual.swift].freeze

projeto = Xcodeproj::Project.open(PROJETO)

if projeto.targets.any? { |t| t.name == ALVO }
  puts "Alvo #{ALVO} já existe — nada a fazer."
  exit 0
end

runner = projeto.targets.find { |t| t.name == "Runner" } or abort("Alvo Runner não encontrado")

alvo = projeto.new_target(:app_extension, ALVO, :ios, "17.0", nil, :swift)

# Arquivos da extensão (grupo com a pasta ios/CardPortaria).
grupo = projeto.main_group.find_subpath(ALVO, true)
grupo.set_source_tree("<group>")
grupo.set_path(ALVO)

(COMPARTILHADOS + SO_EXTENSAO).each do |nome|
  abort("Falta #{ALVO}/#{nome}") unless File.exist?(File.join(IOS, ALVO, nome))
  ref = grupo.new_reference(nome)
  alvo.add_file_references([ref])
  runner.add_file_references([ref]) if COMPARTILHADOS.include?(nome)
end
grupo.new_reference("Info.plist")

fontes = grupo.find_subpath("Fonts", true)
fontes.set_source_tree("<group>")
fontes.set_path("Fonts")
Dir[File.join(IOS, ALVO, "Fonts", "*.ttf")].sort.each do |caminho|
  alvo.add_resources([fontes.new_reference(File.basename(caminho))])
end

# Ponte Swift só do app.
grupo_runner = projeto.main_group.children.find { |g| g.respond_to?(:path) && g.path == "Runner" } or abort("Grupo Runner não encontrado")
abort("Falta Runner/CardAoVivoBridge.swift") unless File.exist?(File.join(IOS, "Runner", "CardAoVivoBridge.swift"))
runner.add_file_references([grupo_runner.new_reference("CardAoVivoBridge.swift")])

# Versão/build da extensão = as do app (FLUTTER_BUILD_NAME/NUMBER). O
# Generated.xcconfig só define variáveis do Flutter — sem o xcconfig dos Pods,
# que levaria as bibliotecas do app para dentro da extensão.
generated = projeto.files.find { |f| f.path == "Flutter/Generated.xcconfig" } or abort("Flutter/Generated.xcconfig não referenciado")

alvo.build_configurations.each do |config|
  config.base_configuration_reference = generated
  s = config.build_settings
  s["PRODUCT_BUNDLE_IDENTIFIER"] = BUNDLE
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["INFOPLIST_FILE"] = "#{ALVO}/Info.plist"
  s["GENERATE_INFOPLIST_FILE"] = "NO"
  s["SWIFT_VERSION"] = "5.0"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "17.0"
  s["TARGETED_DEVICE_FAMILY"] = "1"
  s["SKIP_INSTALL"] = "YES"
  s["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  s["DEVELOPMENT_TEAM"] = TEAM
  s["CODE_SIGN_STYLE"] = "Automatic"
  s["ENABLE_BITCODE"] = "NO"
  s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
  s.delete("ASSETCATALOG_COMPILER_APPICON_NAME")
  s.delete("ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME")
end

# Embute a extensão no app. A fase precisa vir ANTES do "Thin Binary": depois
# dele o Xcode 15+ acusa ciclo de dependência no alvo Runner.
fase = runner.new_copy_files_build_phase("Embed Foundation Extensions")
fase.symbol_dst_subfolder_spec = :plug_ins
arquivo = fase.add_file_reference(alvo.product_reference, true)
arquivo.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
runner.build_phases.delete(fase)
indice = runner.build_phases.index { |f| f.respond_to?(:name) && f.name == "Thin Binary" } || runner.build_phases.length
runner.build_phases.insert(indice, fase)

runner.add_dependency(alvo)

projeto.save
puts "Alvo #{ALVO} criado (#{BUNDLE}), embutido no Runner antes do Thin Binary."

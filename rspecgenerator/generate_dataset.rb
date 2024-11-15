require 'find'
require 'json'

class DatasetGeneratorService
  attr_reader :project_root, :limit, :dataset

  def initialize(project_root = ".", limit = nil)
    @project_root = project_root
    @limit = limit
    @dataset = []
  end

  def generate_dataset
    Find.find("#{project_root}/app") do |path|
      next unless path.end_with?('.rb') # Process only Ruby files

      methods = extract_methods_from_file(path)
      spec_file = corresponding_spec_file(path)

      if spec_file
        rspec_blocks = extract_rspec_blocks(spec_file)
        methods.each do |method_name, method_code|
          if rspec_blocks.key?(method_name)
            add_to_dataset(method_name, method_code, rspec_blocks[method_name])
          end
          break if limit && dataset.size >= limit
        end
      end
      break if limit && dataset.size >= limit
    end

    save_dataset_to_file
  end

  private

  def extract_methods_from_file(file_path)
    methods = {}
    file_content = File.read(file_path)

    file_content.scan(/def\s+(\w+)(.*?)(^end$)/m).each do |method_name, params, method_code|
      full_method = "def #{method_name}#{params}#{method_code.strip}end"
      methods[method_name] = full_method
    end
    methods
  end

  def corresponding_spec_file(file_path)
    spec_file = file_path.sub('/app/', '/spec/').sub('.rb', '_spec.rb')
    File.exist?(spec_file) ? spec_file : nil
  end

  def extract_rspec_blocks(spec_file)
    rspec_blocks = {}
    file_content = File.read(spec_file)

    file_content.scan(/describe ['"](.*?)['"] do(.*?)end/m).each do |method_name, block_content|
      rspec_blocks[method_name] = "describe '#{method_name}' do#{block_content.strip}end"
    end
    rspec_blocks
  end

  def add_to_dataset(method_name, method_code, rspec_block)
    dataset << {
      "instruction" => "Write an RSpec test for the following Rails method, using described_class as the main test subject.",
      "input" => method_code,
      "output" => rspec_block,
      "text" => generate_text(method_name, method_code, rspec_block)
    }
  end

  def generate_text(method_name, method_code, rspec_block)
    <<-TEXT
Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
Write an RSpec test for the following Rails method, using described_class as the main test subject.

### Input:
#{method_code}

### Response:
#{rspec_block}
    TEXT
  end

  def save_dataset_to_file
    # Get the directory of the current Ruby script
    script_dir = File.dirname(__FILE__)

    # Ensure the 'datasets' directory exists within the script's directory
    dataset_dir = File.join(script_dir, 'datasets')
    Dir.mkdir(dataset_dir) unless Dir.exist?(dataset_dir)

    # Write the dataset to a file inside the 'tmp' directory within the script's directory
    File.open(File.join(dataset_dir, 'dataset.json'), 'w') do |file|
      file.write(JSON.pretty_generate(dataset))
    end

    puts "Dataset saved to #{dataset_dir}/dataset.json"
  end

end

# Accept command-line arguments for project root and limit
project_root = ARGV[0] || '.'
limit = ARGV[1].to_i > 0 ? ARGV[1].to_i : nil

generator = DatasetGeneratorService.new(project_root, limit)
generator.generate_dataset

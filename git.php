<?php

echo "OLA FBN";

putenv("HOME=/home/criisadmin");

$currentUser = get_current_user();
echo "<p>Current User: " . $currentUser . "</p>";

$output = shell_exec("whoami");
echo "<pre>$output</pre>";

$output = shell_exec("git config --global --add safe.directory /var/www/html/pikachu/pikachuPM 2>&1");
echo "<pre>$output</pre>";


// Executar o comando 'git pull'
$output = shell_exec('git pull 2>&1');

// Exibir a saída do comando
echo "<pre>$output</pre>";
echo "done";

$output = shell_exec("cd PKMT 2>&1");
echo "<pre>$output</pre>";

$output = shell_exec("cd PKMT && npm install 2>&1");
echo "<pre>$output</pre>";

$output = shell_exec("cd PKMT && npm run build 2>&1");
echo "<pre>$output</pre>";

// Verifica se o parâmetro 'var' está presente na URL
if (isset($_GET['dbhost'])) {
    // Imprime o valor do parâmetro 'var'
    $var = $_GET['dbhost'];
    echo "O valor de 'var' é: " . $var;
} else {
    echo "O parâmetro 'var' não foi passado.";
}

exit;
// Nome do arquivo PHP a ser gerado
//$newFileName = 'config.php';

// Dados recebidos via GET
//$getParams = $_GET;

// Conteúdo inicial do arquivo PHP
//$fileContent = "<?php\n\n";
//$fileContent .= "// Este arquivo foi gerado dinamicamente.\n";
//$fileContent .= "// Variáveis passadas via GET.\n\n";

// Gerar código PHP para cada variável GET
foreach ($getParams as $key => $value) {
    // Sanitizar o nome da variável e o valor
    $sanitizedKey = preg_replace('/[^a-zA-Z0-9_]/', '', $key);
    $sanitizedValue = addslashes($value);

    // Adicionar a variável ao conteúdo
    $fileContent .= "\$$sanitizedKey = '$sanitizedValue';\n";
}

// Adicionar um exemplo de uso das variáveis
//$fileContent .= "\n// Exemplo de uso\n";
//$fileContent .= "echo \"As variáveis foram geradas dinamicamente!\\n\";\n";
//$fileContent .= "echo \"Valor de uma variável: \$$sanitizedKey\";\n";

// Finalizar o conteúdo PHP
$fileContent .= "\n?>";

// Escrever o conteúdo em um novo arquivo PHP
if (file_put_contents($newFileName, $fileContent)) {
    echo "O arquivo $newFileName foi gerado com sucesso!";
//    echo "<br><a href='$newFileName'>Clique aqui para visualizar o arquivo gerado</a>";
} else {
    echo "Erro ao criar o arquivo $newFileName.";
}
?>
